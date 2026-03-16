"""Admin-routes: användarhantering, inställningar, säkerhetskopior, kyrkogårdar, achievements."""
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user, hash_password, require_admin
from app.config import API_KEYS_PATH, BACKUP_DIR, DATABASE_PATH
from app.database import (
    AchievementNiva,
    AchievementYrkesGrupp,
    Gravplats,
    GravplatsRedigeringslogg,
    Kyrkogard,
    User,
    get_db,
)
from app.schemas import (
    AchievementNivaUpdateBody,
    AchievementYrkesGruppBody,
    ApiKeysBody,
    ClaudeAktivBody,
    ClaudeBatchAktivBody,
    CreateUserBody,
    CreateUserWithPasswordBody,
    KyrkogardCreateBody,
    MePreferencesBody,
    SetPasswordBody,
    SetUsernameBody,
)
from app.utils.achievements import _compute_achievements_niva
from app.utils.api_keys import _get_anthropic_api_key, _get_claude_batch_block_enskild, _get_claude_instans_aktiv, _get_spara_redigeringslogg_snapshot, _set_api_keys_json
from app.utils.git_version import GIT_VERSION
from app.utils.text import _sanitize_backup_filename_part

router = APIRouter()


# ---------- Säkerhetskopior ----------

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
    """Skapa säkerhetskopia av databasen. Filnamn: gravregister_YYYY-MM-DD_HH-MM-SS_branch-{branch}_commit-{commit}.db."""
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
    """Ladda ner en säkerhetskopia – endast admin. Filnamn måste vara .db och ligga i BACKUP_DIR."""
    from fastapi.responses import FileResponse
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Ogiltigt filnamn")
    if not filename.endswith(".db"):
        raise HTTPException(status_code=400, detail="Endast .db-filer")
    path = BACKUP_DIR / filename
    if not path.is_file() or not path.resolve().is_relative_to(BACKUP_DIR.resolve()):
        raise HTTPException(status_code=404, detail="Filen finns inte")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


# ---------- API-nycklar / inställningar ----------

@router.get("/api/settings/api-keys")
async def get_api_keys(admin: User = Depends(require_admin)):
    """Returnera status för API-nycklar (om de är satta och en maskerad förhandsgranskning). Endast admin."""
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
        API_KEYS_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Kunde inte spara nyckelfilen: {e}")
    return {"ok": True}


# ---------- Användarhantering ----------

@router.get("/api/admin/users")
async def list_users(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Lista alla användare (endast admin)."""
    users = db.query(User).order_by(User.username).all()
    return {"users": [{"id": u.id, "username": u.username, "is_admin": u.is_admin, "claude_aktiv": getattr(u, "claude_aktiv", True), "claude_batch_aktiv": getattr(u, "claude_batch_aktiv", False)} for u in users]}


@router.put("/api/admin/users/{user_id:int}/claude-aktiv")
async def set_user_claude_aktiv(
    user_id: int,
    body: ClaudeAktivBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Aktivera eller inaktivera Claude-funktioner för en användare. Endast admin."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    user.claude_aktiv = body.aktiv
    db.commit()
    return {"ok": True, "claude_aktiv": user.claude_aktiv}


@router.put("/api/admin/users/{user_id:int}/claude-batch-aktiv")
async def set_user_claude_batch_aktiv(
    user_id: int,
    body: ClaudeBatchAktivBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Aktivera eller inaktivera Claude batch-funktioner för en användare. Endast admin."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    user.claude_batch_aktiv = body.aktiv
    db.commit()
    return {"ok": True, "claude_batch_aktiv": user.claude_batch_aktiv}


@router.post("/api/admin/users")
async def create_user(body: CreateUserBody, admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Skapa nytt konto med tillfälligt lösenord (endast admin)."""
    username = (body.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Användarnamn krävs")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Användarnamnet finns redan")
    temp_password = os.urandom(8).hex()
    user = User(username=username, password_hash=hash_password(temp_password), is_admin=False)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username, "temp_password": temp_password}


@router.post("/api/admin/users/new")
async def create_user_with_password(
    body: CreateUserWithPasswordBody, admin: User = Depends(require_admin), db: Session = Depends(get_db)
):
    """Skapa nytt konto med användarnamn och lösenord (endast admin)."""
    username = (body.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Användarnamn krävs")
    if not (body.password or "").strip():
        raise HTTPException(status_code=400, detail="Lösenord krävs")
    if db.query(User).filter(User.username == username).first():
        raise HTTPException(status_code=400, detail="Användarnamnet finns redan")
    user = User(username=username, password_hash=hash_password((body.password or "").strip()), is_admin=False)
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username}


@router.put("/api/admin/users/{user_id:int}/password")
async def set_user_password(
    user_id: int,
    body: SetPasswordBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sätt eller återställ lösenord (endast admin)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    pwd = (body.password or "").strip()
    if not pwd:
        raise HTTPException(status_code=400, detail="Lösenord krävs")
    user.password_hash = hash_password(pwd)
    db.commit()
    return {"ok": True}


@router.patch("/api/admin/users/{user_id:int}")
async def set_user_username(
    user_id: int,
    body: SetUsernameBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Byt användarnamn (endast admin)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    username = (body.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Användarnamn krävs")
    if db.query(User).filter(User.username == username, User.id != user_id).first():
        raise HTTPException(status_code=400, detail="Användarnamnet finns redan")
    user.username = username
    db.commit()
    return {"ok": True, "username": user.username}


@router.get("/api/admin/users/{user_id:int}/preferences")
async def get_user_preferences(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Hämta roliga saker-inställningar för en användare (endast admin)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    prefs = {}
    if getattr(user, "preferences", None) and (user.preferences or "").strip():
        try:
            prefs = json.loads(user.preferences)
        except (json.JSONDecodeError, TypeError):
            pass
    default_sections = ["innehavare", "narmast_anhoriga", "gravplatsen", "skiss", "gravsatta"]
    sections_pref = prefs.get("inmatning_sections_order") or default_sections
    allowed = default_sections
    sections_order: list[str] = []
    for s in sections_pref:
        if s in allowed and s not in sections_order:
            sections_order.append(s)
    for s in allowed:
        if s not in sections_order:
            sections_order.append(s)
    return {
        "preferences": {
            "fun_enabled": prefs.get("fun_enabled", True),
            "toast_on_new_yrke": prefs.get("toast_on_new_yrke", True),
            "sound_on_new_yrke": prefs.get("sound_on_new_yrke", True),
            "inmatning_sections_order": sections_order,
        },
    }


@router.get("/api/admin/users/{user_id:int}/achievements")
async def get_user_achievements_admin(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Prestationer/utmärkelser för en användare (endast admin). Samma struktur som /api/me/achievements."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    first_last = (
        db.query(
            func.min(GravplatsRedigeringslogg.edited_at).label("first"),
            func.max(GravplatsRedigeringslogg.edited_at).label("last"),
        )
        .filter(GravplatsRedigeringslogg.user_id == user_id)
        .first()
    )
    first_at = first_last.first if first_last else None
    last_at = first_last.last if first_last else None
    nivaer = _compute_achievements_niva(db, user_id)
    antal_registreringar = next((n["current_value"] for n in nivaer if n["achievement_key"] == "registreringar"), 0)
    antal_fardigtranskriberade = next((n["current_value"] for n in nivaer if n["achievement_key"] == "fardigtranskriberade"), 0)
    antal_innehavare = next((n["current_value"] for n in nivaer if n["achievement_key"] == "innehavare"), 0)
    antal_narmast_anhoriga = next((n["current_value"] for n in nivaer if n["achievement_key"] == "narmast_anhoriga"), 0)
    antal_gravsatta = next((n["current_value"] for n in nivaer if n["achievement_key"] == "gravsatta"), 0)
    antal_skisser = next((n["current_value"] for n in nivaer if n["achievement_key"] == "skisser"), 0)
    antal_unika_yrken = next((n["current_value"] for n in nivaer if n["achievement_key"] == "unika_yrken"), 0)
    return {
        "username": user.username,
        "antal_registreringar": antal_registreringar,
        "antal_fardigtranskriberade": antal_fardigtranskriberade,
        "antal_innehavare": antal_innehavare,
        "antal_narmast_anhoriga": antal_narmast_anhoriga,
        "antal_gravsatta": antal_gravsatta,
        "antal_skisser": antal_skisser,
        "antal_unika_yrken": antal_unika_yrken,
        "forsta_registrering": first_at,
        "senaste_registrering": last_at,
        "nivaer": nivaer,
    }


@router.patch("/api/admin/users/{user_id:int}/preferences")
async def set_user_preferences(
    user_id: int,
    body: MePreferencesBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Sätt roliga saker-inställningar för en användare (endast admin)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    prefs = {}
    if getattr(user, "preferences", None) and (user.preferences or "").strip():
        try:
            prefs = json.loads(user.preferences)
        except (json.JSONDecodeError, TypeError):
            pass
    if body.fun_enabled is not None:
        prefs["fun_enabled"] = body.fun_enabled
    if body.toast_on_new_yrke is not None:
        prefs["toast_on_new_yrke"] = body.toast_on_new_yrke
    if body.sound_on_new_yrke is not None:
        prefs["sound_on_new_yrke"] = body.sound_on_new_yrke
    if body.inmatning_sections_order is not None:
        allowed = ["innehavare", "narmast_anhoriga", "gravplatsen", "skiss", "gravsatta"]
        unique = []
        for s in body.inmatning_sections_order:
            if s in allowed and s not in unique:
                unique.append(s)
        for s in allowed:
            if s not in unique:
                unique.append(s)
        prefs["inmatning_sections_order"] = unique
    user.preferences = json.dumps(prefs) if prefs else None
    db.commit()
    return {"ok": True, "preferences": prefs}


@router.delete("/api/admin/users/{user_id:int}")
async def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Ta bort användarkonto (endast admin). Du kan inte ta bort ditt eget konto."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Du kan inte ta bort ditt eget konto")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Användaren hittades inte")
    db.delete(user)
    db.commit()
    return {"ok": True}


# ---------- Kyrkogårdar ----------

def _antal_gravplatser_kyrkogard(db: Session, kod: str) -> int:
    """Antal gravplatser som har denna kyrkogård (trimmar kyrkogard-fältet)."""
    return (
        db.query(Gravplats)
        .filter(Gravplats.kyrkogard.isnot(None))
        .filter(func.trim(Gravplats.kyrkogard) == kod.strip())
        .count()
    )


@router.get("/api/admin/kyrkogardar")
async def list_admin_kyrkogardar(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lista kyrkogårdar med info om de kan tas bort (saknar gravplatser)."""
    rows = db.query(Kyrkogard).order_by(Kyrkogard.kod).all()
    result = []
    for r in rows:
        antal = _antal_gravplatser_kyrkogard(db, r.kod)
        result.append({"kod": r.kod, "kan_ta_bort": antal == 0})
    return {"kyrkogardar": result}


@router.post("/api/admin/kyrkogardar")
async def create_kyrkogard(
    body: KyrkogardCreateBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lägg till en kyrkogård. Koden måste vara unik."""
    kod = (body.kod or "").strip()
    if not kod:
        raise HTTPException(status_code=400, detail="Kyrkogård måste ha en kod")
    if db.query(Kyrkogard).filter(Kyrkogard.kod == kod).first():
        raise HTTPException(status_code=400, detail="Denna kyrkogård finns redan")
    db.add(Kyrkogard(kod=kod))
    db.commit()
    return {"ok": True, "kod": kod}


@router.delete("/api/admin/kyrkogardar/{kod}")
async def delete_kyrkogard(
    kod: str,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Ta bort en kyrkogård. Möjligt endast om inga gravplatser är kopplade till den."""
    kod_stripped = (kod or "").strip()
    if not kod_stripped:
        raise HTTPException(status_code=400, detail="Ogiltig kod")
    antal = _antal_gravplatser_kyrkogard(db, kod_stripped)
    if antal > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Kan inte ta bort: det finns {antal} gravplatser kopplade till denna kyrkogård.",
        )
    row = db.query(Kyrkogard).filter(Kyrkogard.kod == kod_stripped).first()
    if not row:
        raise HTTPException(status_code=404, detail="Kyrkogården hittades inte")
    db.delete(row)
    db.commit()
    return {"ok": True}


# ---------- Achievement-nivåer ----------

@router.get("/api/admin/achievement-niva")
async def list_achievement_niva(admin: User = Depends(require_admin), db: Session = Depends(get_db)):
    """Lista alla prestationsnivåer (brons/silver/guld) – endast admin."""
    rows = db.query(AchievementNiva).order_by(AchievementNiva.achievement_key, AchievementNiva.threshold).all()
    return {
        "nivaer": [
            {
                "id": r.id,
                "achievement_key": r.achievement_key,
                "level": r.level,
                "threshold": r.threshold,
                "label": r.label,
            }
            for r in rows
        ],
    }


@router.patch("/api/admin/achievement-niva")
async def update_achievement_niva(
    body: AchievementNivaUpdateBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Uppdatera en prestationsnivå (gränsvärde) – endast admin."""
    row = (
        db.query(AchievementNiva)
        .filter(
            AchievementNiva.achievement_key == body.achievement_key,
            AchievementNiva.level == body.level,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Nivån hittades inte")
    row.threshold = body.threshold
    if body.label is not None:
        row.label = body.label
    db.commit()
    return {"ok": True, "achievement_key": row.achievement_key, "level": row.level, "threshold": row.threshold}


@router.get("/api/admin/achievement-yrkesgrupp")
async def list_achievement_yrkesgrupp(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lista alla yrkesgrupper för yrkesbaserade achievements – endast admin."""
    rows = db.query(AchievementYrkesGrupp).order_by(
        AchievementYrkesGrupp.achievement_key, AchievementYrkesGrupp.yrke
    ).all()
    grupper: dict[str, list[str]] = {}
    for r in rows:
        key = (r.achievement_key or "").strip()
        yrke = (r.yrke or "").strip()
        if not key or not yrke:
            continue
        grupper.setdefault(key, []).append(yrke)
    return {
        "grupper": [
            {"achievement_key": key, "yrken": yrken}
            for key, yrken in sorted(grupper.items(), key=lambda kv: kv[0])
        ]
    }


@router.patch("/api/admin/achievement-yrkesgrupp")
async def update_achievement_yrkesgrupp(
    body: AchievementYrkesGruppBody,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Uppdatera vilka yrken som ingår i en viss yrkesbaserad prestationsnyckel.

    Alla befintliga poster för nyckeln ersätts med den angivna listan.
    """
    key = (body.achievement_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="achievement_key krävs")
    # Rensa befintliga rader för denna nyckel
    db.query(AchievementYrkesGrupp).filter(AchievementYrkesGrupp.achievement_key == key).delete()
    # Lägg till nya unika, icke-tomma yrken
    seen: set[str] = set()
    for yrke in body.yrken:
        y = (yrke or "").strip()
        if not y or y in seen:
            continue
        seen.add(y)
        db.add(AchievementYrkesGrupp(achievement_key=key, yrke=y))
    db.commit()
    return {"ok": True, "achievement_key": key, "antal_yrken": len(seen)}
