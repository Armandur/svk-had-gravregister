"""Logg-routes: redigeringslogg för gravplatser och Claude OCR-anropslogg."""
import json

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import (
    ClaudeAnropslogg,
    ClaudeOcrSvar,
    Gravplats,
    GravplatsRedigeringslogg,
    MappConfig,
    User,
    get_db,
)
from app.utils.text import _format_fullstandigt
from fastapi import HTTPException

router = APIRouter()


@router.get("/api/loggar/gravplatser")
async def list_loggar_gravplatser(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = 500,
    offset: int = 0,
    anvandare: str | None = None,
    gravplats_id: int | None = None,
    gravplats: str | None = None,
):
    """
    Lista redigeringslogg för gravplatser – kronologisk ordning (senaste först). Endast admin.
    anvandare: filtrera på användarnamn (delsträng).
    gravplats_id: filtrera på specifik gravplats (exakt ID).
    gravplats: filtrera på gravplatsidentifierare (delsträng på fullständigt, t.ex. "HKG A 12").
    """
    q = (
        db.query(GravplatsRedigeringslogg, Gravplats, MappConfig.namn, User.username)
        .join(Gravplats, GravplatsRedigeringslogg.gravplats_id == Gravplats.id)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .join(User, GravplatsRedigeringslogg.user_id == User.id)
    )
    if anvandare and anvandare.strip():
        q = q.filter(User.username.ilike("%" + anvandare.strip() + "%"))
    if gravplats_id is not None:
        q = q.filter(GravplatsRedigeringslogg.gravplats_id == gravplats_id)
    if gravplats and gravplats.strip():
        sok = "%" + gravplats.strip() + "%"
        q = q.filter(
            (Gravplats.kyrkogard + " " + Gravplats.kvarter + " " + Gravplats.gravplatsnummer).ilike(sok)
        )
    total = q.count()
    rows = (
        q.order_by(GravplatsRedigeringslogg.edited_at.desc())
        .offset(max(0, offset))
        .limit(max(1, min(limit, 2000)))
        .all()
    )
    loggar = []
    for logg, g, mapp_namn, username in rows:
        fullstandigt = _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer)
        snapshot = None
        if logg.inmatning_snapshot:
            try:
                snapshot = json.loads(logg.inmatning_snapshot)
            except (json.JSONDecodeError, TypeError):
                pass
        loggar.append({
            "id": logg.id,
            "gravplats_id": logg.gravplats_id,
            "fullstandigt": fullstandigt,
            "mapp_namn": mapp_namn or "",
            "username": username or "",
            "edited_at": logg.edited_at,
            "inmatning_snapshot": snapshot,
        })
    return {"loggar": loggar, "antal": len(loggar), "total": total}


@router.get("/api/ocr/gravplats/{gravplats_id:int}/svar")
async def get_ocr_svar(
    gravplats_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hämta senaste sparade Claude OCR-svar för en gravplats."""
    row = (
        db.query(ClaudeOcrSvar, User.username)
        .join(User, ClaudeOcrSvar.user_id == User.id)
        .filter(ClaudeOcrSvar.gravplats_id == gravplats_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Inget sparat Claude-svar")
    svar, username = row
    return {
        "svar_json": json.loads(svar.svar_json),
        "ocr_kommentar": svar.ocr_kommentar,
        "skapad_den": svar.skapad_den,
        "username": username or "",
    }


@router.get("/api/loggar/claude")
async def list_loggar_claude(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    limit: int = 500,
    offset: int = 0,
    anvandare: str | None = None,
):
    """
    Lista Claude OCR-anropslogg med tokenanvändning och kostnad – kronologisk (senaste först). Endast admin.
    """
    q = (
        db.query(ClaudeAnropslogg, Gravplats, MappConfig.namn, User.username)
        .join(User, ClaudeAnropslogg.user_id == User.id)
        .outerjoin(Gravplats, ClaudeAnropslogg.gravplats_id == Gravplats.id)
        .outerjoin(MappConfig, Gravplats.mapp_id == MappConfig.id)
    )
    if anvandare and anvandare.strip():
        q = q.filter(User.username.ilike("%" + anvandare.strip() + "%"))
    total = q.count()
    rows = (
        q.order_by(ClaudeAnropslogg.anropad_den.desc())
        .offset(max(0, offset))
        .limit(max(1, min(limit, 2000)))
        .all()
    )

    # Summera totalkostnad för alla rader (ofiltrerat på anvandare för totalraden)
    totalt_kostnad = db.query(func.sum(ClaudeAnropslogg.kostnad_usd)).scalar() or 0.0

    loggar = []
    for logg, g, mapp_namn, username in rows:
        fullstandigt = _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer) if g else ""
        loggar.append({
            "id": logg.id,
            "gravplats_id": logg.gravplats_id,
            "fullstandigt": fullstandigt,
            "mapp_namn": mapp_namn or "",
            "username": username or "",
            "anropad_den": logg.anropad_den,
            "input_tokens": logg.input_tokens,
            "output_tokens": logg.output_tokens,
            "cache_creation_tokens": logg.cache_creation_tokens,
            "cache_read_tokens": logg.cache_read_tokens,
            "kostnad_usd": logg.kostnad_usd,
            "svarstid_ms": logg.svarstid_ms,
        })
    return {"loggar": loggar, "antal": len(loggar), "total": total, "totalt_kostnad_usd": round(totalt_kostnad, 4)}
