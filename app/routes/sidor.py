"""Alla HTML-sidor (FileResponse-rutter) samt hjälp-API och dev-endpoint."""
import os
import re
import signal
import sys
import threading
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, Response

from app.database import User
from app.auth import get_current_user, require_admin

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
DOCS_DIR = Path(__file__).resolve().parent.parent.parent / "docs"
SPECIFICATION_PATH = Path(__file__).resolve().parent.parent.parent / "SPECIFICATION.md"

router = APIRouter()


# ---------- Hjälp / dokumentation ----------

_HJALP_TITLAR = {
    "overview": "Översikt",
    "bladdring": "Bläddring och visning",
    "inmatning": "Inmatning och transkribering",
    "extramaterial": "Extramaterial",
    "grunddata": "Grunddata och kyrkogårdar",
    "admin": "Administratörsguide",
    "specifikation-generell": "Specifikation – Allmän modell",
    "specifikation-harnosand-skandix": "Specifikation – Härnösands domkyrkoförsamling (Skandix/Remington System Sy)",
}


def _hjalp_fil(slug: str) -> tuple[Path, str] | None:
    if slug == "specifikation":
        if SPECIFICATION_PATH.exists():
            return (SPECIFICATION_PATH, "Specifikation (översikt)")
        return None
    if not re.match(r"^[a-z0-9-]+$", slug):
        return None
    p = DOCS_DIR / f"{slug}.md"
    if p.exists():
        return (p, _HJALP_TITLAR.get(slug, slug.replace("-", " ").title()))
    return None


@router.get("/hjalp")
async def hjalp_sida():
    return FileResponse(STATIC_DIR / "hjalp.html")


@router.get("/api/hjalp")
async def api_hjalp_lista():
    dokument = []
    for slug, titel in [
        ("overview", "Översikt"),
        ("bladdring", "Bläddring och visning"),
        ("inmatning", "Inmatning och transkribering"),
        ("extramaterial", "Extramaterial"),
        ("grunddata", "Grunddata och kyrkogårdar"),
        ("admin", "Administratörsguide"),
        ("specifikation", "Specifikation (översikt)"),
        ("specifikation-generell", "Specifikation – Allmän modell"),
        ("specifikation-harnosand-skandix", "Specifikation – Härnösands domkyrkoförsamling (Skandix/Remington System Sy)"),
    ]:
        if _hjalp_fil(slug):
            dokument.append({"slug": slug, "titel": titel})
    return {"dokument": dokument}


@router.get("/api/hjalp/{slug}")
async def api_hjalp_innehall(slug: str):
    res = _hjalp_fil(slug)
    if not res:
        raise HTTPException(status_code=404, detail="Dokument hittades inte")
    path, _ = res
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        raise HTTPException(status_code=404, detail="Dokument kunde inte läsas")
    return PlainTextResponse(content, media_type="text/markdown; charset=utf-8")


# ---------- Gravplatser HTML ----------

@router.get("/gravplatser")
@router.get("/gravplatser/{gravplats_slug:path}")
async def gravplatser_sida(gravplats_slug: str | None = None):
    if gravplats_slug == "sok":
        return FileResponse(STATIC_DIR / "gravplatser-sok.html")
    if gravplats_slug is None:
        return FileResponse(STATIC_DIR / "gravplatser-trad.html")
    return FileResponse(STATIC_DIR / "gravplatser-visa.html")


# ---------- Yrken och prestationer ----------

@router.get("/yrken")
async def yrken_sida():
    return FileResponse(STATIC_DIR / "yrken.html")


@router.get("/prestationer")
async def prestationer_sida():
    return FileResponse(STATIC_DIR / "prestationer.html")


# ---------- Batch Claude ----------

@router.get("/batch-claude", response_class=HTMLResponse)
async def batch_claude_page():
    return FileResponse("static/batch-claude.html")


# ---------- Admin-sidor ----------

@router.get("/admin")
async def admin_sida():
    return FileResponse(STATIC_DIR / "admin.html")


@router.get("/admin/achievement-niva")
async def admin_achievement_niva_sida():
    return FileResponse(STATIC_DIR / "admin-achievement-niva.html")


@router.get("/admin/users/{user_id:int}/prestationer")
async def admin_user_prestationer_sida(user_id: int, admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "admin-user-prestationer.html")


# ---------- Loggar ----------

@router.get("/loggar")
async def loggar_sida():
    return FileResponse(STATIC_DIR / "loggar.html")


@router.get("/loggar/claude")
async def loggar_claude_sida():
    return FileResponse(STATIC_DIR / "loggar-claude.html")


# ---------- Databasunderhåll ----------

@router.get("/databasunderhall")
async def databasunderhall_sida(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall.html")


@router.get("/databasunderhall/saknar-postnummer-ort")
async def databasunderhall_saknar_postnummer_ort(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-saknar-postnummer-ort.html")


@router.get("/databasunderhall/datakvalitet-ofodd-f")
async def databasunderhall_ofodd_f(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-datakvalitet-ofodd-f.html")


@router.get("/databasunderhall/datakvalitet-skisser")
async def databasunderhall_datakvalitet_skisser(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-datakvalitet-skisser.html")


@router.get("/databasunderhall/granska-anvandare")
async def databasunderhall_granska_anvandare(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-granska-anvandare.html")


@router.get("/databasunderhall/datakvalitet-datum")
async def databasunderhall_datakvalitet_datum(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-datakvalitet-datum.html")


@router.get("/databasunderhall/datakvalitet-postnummer-adress")
async def databasunderhall_datakvalitet_postnummer(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-datakvalitet-postnummer-adress.html")


@router.get("/databasunderhall/datakvalitet-dubbletter")
async def databasunderhall_datakvalitet_dubbletter(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-datakvalitet-dubbletter.html")


@router.get("/databasunderhall/datakvalitet-innehavare-gravsatta")
async def databasunderhall_datakvalitet_innehavare_gravsatta(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-datakvalitet-innehavare-gravsatta.html")


@router.get("/databasunderhall/datakvalitet-beteckning")
async def databasunderhall_datakvalitet_beteckning(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-datakvalitet-beteckning.html")


@router.get("/databasunderhall/generell-tecken")
async def databasunderhall_generell_tecken(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-generell-tecken.html")


@router.get("/databasunderhall/generell-siffror-komma")
async def databasunderhall_generell_siffror_komma(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-generell-siffror-komma.html")


@router.get("/databasunderhall/generell-langd")
async def databasunderhall_generell_langd(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-generell-langd.html")


@router.get("/databasunderhall/generell-mellanslag")
async def databasunderhall_generell_mellanslag(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-generell-mellanslag.html")


@router.get("/databasunderhall/generell-endast-siffror")
async def databasunderhall_generell_endast_siffror(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "databasunderhall-generell-endast-siffror.html")


# ---------- Grunddata ----------

@router.get("/listvy")
async def listvy_sida(current_user: User = Depends(get_current_user), admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "listvy.html")


@router.get("/grunddata")
async def grunddatahantering_sida(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "grunddatahantering.html")


@router.get("/grunddata/kyrkogardar")
async def grunddata_kyrkogardar_sida(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "grunddata-kyrkogardar.html")


# ---------- Övriga sidor ----------

@router.get("/sakerhetskopior")
async def sakerhetskopior_sida(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "sakerhetskopior.html")


@router.get("/installningar")
async def installningar_sida(admin: User = Depends(require_admin)):
    return FileResponse(STATIC_DIR / "installningar.html")


@router.get("/login")
async def login_sida():
    return FileResponse(STATIC_DIR / "login.html")


# ---------- Dev ----------

def _do_shutdown():
    import time
    time.sleep(0.3)
    try:
        parent_pid = os.getppid()
        if sys.platform == "win32":
            import subprocess
            subprocess.run(["taskkill", "/F", "/PID", str(parent_pid)], capture_output=True)
        else:
            os.kill(parent_pid, signal.SIGTERM)
    except Exception:
        pass
    os._exit(0)


@router.post("/api/dev/shutdown")
async def dev_shutdown(current_user: User = Depends(get_current_user)):
    """Stänger av appen (uvicorn)."""
    threading.Thread(target=_do_shutdown, daemon=True).start()
    return {"ok": True}
