"""System-rutter: root, version, säkerhetskopior och API-nyckelinställningar."""
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import BACKUP_DIR, DATABASE_PATH, API_KEYS_PATH
from app.database import User
from app.auth import require_admin
from app.utils.git_version import GIT_VERSION
from app.utils.api_keys import (
    _get_anthropic_api_key,
    _get_claude_instans_aktiv,
    _get_claude_batch_block_enskild,
    _get_spara_redigeringslogg_snapshot,
    _get_claude_pris,
    _get_claude_pris_from_env,
)

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"

router = APIRouter()


# ---------- Startsida och version ----------

@router.get("/")
async def root():
    """Startsida – meny till programmets delar."""
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/profil")
async def profil():
    """Profilsida för inloggad användare – byt lösenord och preferenser."""
    return FileResponse(STATIC_DIR / "profil.html")


@router.get("/api/version")
def api_version():
    """Aktuellt commit-id och branch för visning som version på startsidan."""
    return {"commit": GIT_VERSION.get("commit"), "branch": GIT_VERSION.get("branch")}


# ---------- Säkerhetskopior ----------

def _sanitize_backup_filename_part(s: str | None) -> str:
    """Endast alfanumeriskt, bindestreck och understreck (för branch/commit i filnamn)."""
    if not s or not s.strip():
        return "unknown"
    return re.sub(r"[^a-zA-Z0-9_-]", "", s.strip())[:80] or "unknown"


@router.get("/api/backups")
def list_backups(admin: User = Depends(require_admin)):
    """Lista säkerhetskopior (filnamn, storlek, datum) – endast admin."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    files = []
    for p in sorted(BACKUP_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True):
        if p.is_file() and p.suffix == ".db":
            st = p.stat()
            files.append({
                "name": p.name,
                "size": st.st_size,
                "mtime": st.st_mtime,
            })
    return {"backups": files}


@router.post("/api/backups")
def create_backup(admin: User = Depends(require_admin)):
    """Skapa säkerhetskopia av databasen."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    datum = now.strftime("%Y-%m-%d")
    tid = now.strftime("%H-%M-%S")
    branch = _sanitize_backup_filename_part(GIT_VERSION.get("branch"))
    commit = _sanitize_backup_filename_part(GIT_VERSION.get("commit"))
    name = f"gravregister_{datum}_{tid}_branch-{branch}_commit-{commit}.db"
    dest = BACKUP_DIR / name
    if not DATABASE_PATH.exists():
        raise HTTPException(status_code=500, detail="Databasfil saknas")
    shutil.copy2(DATABASE_PATH, dest)
    st = dest.stat()
    return {"name": name, "size": st.st_size, "mtime": st.st_mtime}


@router.get("/api/backups/{filename:path}")
def download_backup(filename: str, admin: User = Depends(require_admin)):
    """Ladda ner en säkerhetskopia – endast admin."""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Ogiltigt filnamn")
    if not filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Endast .db-filer")
    path = BACKUP_DIR / filename
    if not path.is_file() or not path.resolve().is_relative_to(BACKUP_DIR.resolve()):
        raise HTTPException(status_code=404, detail="Filen finns inte")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


# ---------- API-nyckelinställningar ----------

class ApiKeysBody(BaseModel):
    anthropic_api_key: str | None = None
    claude_aktiv_instans: bool | None = None
    claude_batch_block_enskild: bool | None = None
    spara_redigeringslogg_snapshot: bool | None = None
    claude_pris_input: float | None = None
    claude_pris_output: float | None = None
    claude_pris_cache_creation: float | None = None
    claude_pris_cache_read: float | None = None


@router.get("/api/settings/api-keys")
async def get_api_keys(admin: User = Depends(require_admin)):
    """Returnera status för API-nycklar. Endast admin."""
    key = _get_anthropic_api_key()
    if key:
        preview = key[:12] + "••••••••••••" if len(key) > 12 else "••••••••••••"
        from_env = bool(os.environ.get("ANTHROPIC_API_KEY"))
    else:
        preview = None
        from_env = False
    return {
        "anthropic_api_key_set": bool(key),
        "anthropic_api_key_preview": preview,
        "anthropic_api_key_from_env": from_env,
        "claude_aktiv_instans": _get_claude_instans_aktiv(),
        "claude_batch_block_enskild": _get_claude_batch_block_enskild(),
        "spara_redigeringslogg_snapshot": _get_spara_redigeringslogg_snapshot(),
        "claude_pris": _get_claude_pris(),
        "claude_pris_from_env": _get_claude_pris_from_env(),
    }


@router.put("/api/settings/api-keys")
async def put_api_keys(body: ApiKeysBody, admin: User = Depends(require_admin)):
    """Spara API-nycklar och instansinställningar till api_keys.json. Endast admin."""
    try:
        existing: dict = {}
        if API_KEYS_PATH.is_file():
            try:
                existing = json.loads(API_KEYS_PATH.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                existing = {}
        if body.anthropic_api_key is not None:
            key = body.anthropic_api_key.strip()
            if key:
                existing["anthropic_api_key"] = key
            else:
                existing.pop("anthropic_api_key", None)
        if body.claude_aktiv_instans is not None:
            existing["claude_aktiv_instans"] = body.claude_aktiv_instans
        if body.claude_batch_block_enskild is not None:
            existing["claude_batch_block_enskild"] = body.claude_batch_block_enskild
        if body.spara_redigeringslogg_snapshot is not None:
            existing["spara_redigeringslogg_snapshot"] = body.spara_redigeringslogg_snapshot
        for key in ("input", "output", "cache_creation", "cache_read"):
            val = getattr(body, f"claude_pris_{key}")
            if val is not None and val > 0:
                existing[f"claude_pris_{key}"] = val
        API_KEYS_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte spara nyckelfilen: {e}")
    return {"ok": True}
