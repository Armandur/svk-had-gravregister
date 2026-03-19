"""Rutter för inmatning (gravrätt, gravsatta, närmast anhöriga) och skisser."""
import base64
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.constants import CACHE_HEADERS
from app.database import (
    get_db,
    User,
    Gravplats,
    GravplatsInmatning,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    GravplatsRedigeringslogg,
    GravplatsSkiss,
    Gravsatt,
    Extramaterial,
)
from app.auth import get_current_user
from app.schemas import InmatningSchema, SkissCreateBody, SkissOrdningBody
from app.utils.achievements import _compute_achievements_niva
from app.utils.api_keys import _get_spara_redigeringslogg_snapshot
from app.utils.gravplats_utils import _inmatning_response

router = APIRouter()


def _unika_yrken_set(db: Session) -> set[str]:
    """Returnera mängd av alla unika yrken (gemener) i databasen."""
    def yrke_values(q):
        return [str(r[0]).strip() for r in q.all() if r[0] is not None and str(r[0]).strip()]
    alla = (
        yrke_values(db.query(GravplatsInnehavare.yrke))
        + yrke_values(db.query(GravplatsNarmastAnhorig.yrke))
        + yrke_values(db.query(Gravsatt.yrke))
    )
    return {y.lower() for y in alla}


@router.get("/api/gravplats/{gravplats_id:int}/inmatning")
async def get_inmatning(gravplats_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Hämta inmatad data för gravplatsen."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    return _inmatning_response(gravplats_id, db)


@router.put("/api/gravplats/{gravplats_id:int}/inmatning")
async def put_inmatning(gravplats_id: int, body: InmatningSchema, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Spara inmatad data för gravplatsen. Optimistic locking via version."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    row = db.query(GravplatsInmatning).filter(GravplatsInmatning.gravplats_id == gravplats_id).first()
    if not row:
        row = GravplatsInmatning(gravplats_id=gravplats_id)
        db.add(row)
        db.flush()
    if body.version is not None:
        current_version = getattr(row, "version", 0)
        if current_version != body.version:
            raise HTTPException(
                status_code=409,
                detail="Gravplatsen har ändrats av någon annan. Ladda om sidan och gör om dina ändringar.",
            )
    yrken_före = _unika_yrken_set(db)
    row.storlek = body.storlek or ""
    row.underhall_text = body.underhall_text or ""
    row.underhall_overstruket = body.underhall_overstruket
    row.gravrattstid = body.gravrattstid or ""
    row.monument = body.monument or ""
    row.gravens_utformning = body.gravens_utformning or ""
    row.karta_nr = body.karta_nr or ""
    row.gravbrev_nr = body.gravbrev_nr or ""
    row.utfordat_den = body.utfordat_den or ""
    row.kommentar = body.kommentar or ""
    row.fardigtranskriberad = body.fardigtranskriberad
    if body.skiss_bild_b64 is not None:
        try:
            row.skiss_bild = base64.b64decode(body.skiss_bild_b64) if body.skiss_bild_b64 else None
        except Exception:
            pass
    db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id == gravplats_id).delete()
    for i, inv in enumerate(body.innehavare):
        fn, en = (inv.fornamn or "").strip(), (inv.efternamn or "").strip()
        gatuadress = (inv.gatuadress or "").strip()
        db.add(GravplatsInnehavare(
            gravplats_id=gravplats_id,
            sort_order=i,
            namn=(fn + " " + en).strip(),
            fornamn=fn,
            efternamn=en,
            yrke=inv.yrke or "",
            adress=gatuadress,
            gatuadress=gatuadress,
            postnummer=(inv.postnummer or "").strip(),
            postort=(inv.postort or "").strip(),
            kommentar=inv.kommentar or "",
        ))
    db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id == gravplats_id).delete()
    for i, na in enumerate(body.narmast_anhoriga):
        fn, en = (na.fornamn or "").strip(), (na.efternamn or "").strip()
        if fn or en:
            db.add(GravplatsNarmastAnhorig(
                gravplats_id=gravplats_id,
                namn=(fn + " " + en).strip(),
                fornamn=fn,
                efternamn=en,
                yrke=na.yrke or "",
                adress=na.adress or "",
                postnummer=na.postnummer or "",
                postort=na.postort or "",
                telefon=na.telefon or "",
                sort_order=i,
                kommentar=na.kommentar or "",
            ))
    db.query(Gravsatt).filter(Gravsatt.gravplats_id == gravplats_id).delete()
    for i, gs in enumerate(body.gravsatta):
        pos = i + 1
        if pos > 10:
            break
        fn, en = (gs.fornamn or "").strip(), (gs.efternamn or "").strip()
        gatuadress = (gs.gatuadress or "").strip()
        db.add(Gravsatt(
            gravplats_id=gravplats_id,
            position=pos,
            ar_beteckning=gs.ar_beteckning,
            namn=(fn + " " + en).strip(),
            fornamn=fn,
            efternamn=en,
            yrke=gs.yrke or "",
            adress=gatuadress,
            gatuadress=gatuadress,
            postnummer=(gs.postnummer or "").strip(),
            postort=(gs.postort or "").strip(),
            fodelse_ar=gs.fodelse_ar,
            fodelse_manad=gs.fodelse_manad,
            fodelse_dag=gs.fodelse_dag,
            fod_nr=gs.fod_nr or "",
            dods_ar=gs.dods_ar,
            dods_manad=gs.dods_manad,
            dods_dag=gs.dods_dag,
            dodsbok_nr=gs.dodsbok_nr or "",
            gravsatt_den=gs.gravsatt_den or "",
            urna=gs.urna or "",
            kommentar=gs.kommentar or "",
        ))
    for item in body.extramaterial_kommentarer or []:
        em_id = item.get("id") if isinstance(item, dict) else getattr(item, "id", None)
        kommentar = item.get("kommentar", "") if isinstance(item, dict) else getattr(item, "kommentar", "")
        if em_id is not None:
            em = db.query(Extramaterial).filter(
                Extramaterial.id == em_id,
                Extramaterial.mapp_id == g.mapp_id,
                Extramaterial.grav_start_sida == g.start_sida,
            ).first()
            if em:
                em.kommentar = (kommentar or "").strip() if isinstance(kommentar, str) else ""
    row.last_edited_by_user_id = current_user.id
    row.last_edited_at = datetime.now(timezone.utc).isoformat()
    row.version = getattr(row, "version", 0) + 1
    snapshot_json = None
    if _get_spara_redigeringslogg_snapshot():
        snapshot_json = body.model_dump_json(exclude={"version"})
    db.add(GravplatsRedigeringslogg(
        gravplats_id=gravplats_id,
        user_id=current_user.id,
        edited_at=row.last_edited_at,
        inmatning_snapshot=snapshot_json,
    ))
    db.commit()
    yrken_efter = _unika_yrken_set(db)
    nya_yrken_i_systemet = yrken_efter - yrken_före
    # Bygg lowercase-set för snittberäkning samt original-map för visning i toast
    yrken_i_bodyn: set[str] = set()
    yrken_original: dict[str, str] = {}  # lowercase → originalform (för toast)
    for sources in [body.innehavare, body.narmast_anhoriga, body.gravsatta]:
        for item in (sources or []):
            y_raw = (getattr(item, "yrke", None) or "").strip()
            if y_raw:
                y_low = y_raw.lower()
                yrken_i_bodyn.add(y_low)
                yrken_original.setdefault(y_low, y_raw)
    new_unique_yrken = sorted(
        yrken_original.get(y, y) for y in (nya_yrken_i_systemet & yrken_i_bodyn)
    )
    resp = _inmatning_response(gravplats_id, db)
    resp["new_unique_yrken"] = new_unique_yrken
    resp["achievements_snapshot"] = _compute_achievements_niva(db, current_user.id)
    return resp


@router.get("/api/gravplats/{gravplats_id:int}/inmatning/skiss")
async def get_inmatning_skiss(gravplats_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Hämta skissbild för gravplatsen (PNG/JPEG). Äldre enkelskiss."""
    row = db.query(GravplatsInmatning).filter(GravplatsInmatning.gravplats_id == gravplats_id).first()
    if not row or not row.skiss_bild:
        raise HTTPException(status_code=404, detail="Ingen skiss")
    return Response(content=row.skiss_bild, media_type="image/png", headers=CACHE_HEADERS)


@router.post("/api/gravplats/{gravplats_id:int}/skisser")
async def post_skiss(gravplats_id: int, body: SkissCreateBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lägg till en skiss (rektangelmarkering på en bild)."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    if body.source_type not in ("halva", "extramaterial"):
        raise HTTPException(status_code=400, detail="source_type måste vara halva eller extramaterial")
    if body.source_type == "halva":
        if body.content_sida is None or body.halva not in ("nedre", "ovre"):
            raise HTTPException(status_code=400, detail="För halva krävs content_sida och halva (nedre/ovre)")
    if body.source_type == "extramaterial":
        if body.extramaterial_id is None:
            raise HTTPException(status_code=400, detail="För extramaterial krävs extramaterial_id")
    max_order = (
        db.query(func.max(GravplatsSkiss.sort_order))
        .filter(GravplatsSkiss.gravplats_id == gravplats_id)
        .scalar()
    )
    sort_order = (max_order or -1) + 1
    s = GravplatsSkiss(
        gravplats_id=gravplats_id,
        source_type=body.source_type,
        content_sida=body.content_sida,
        halva=body.halva,
        segment_index=body.segment_index,
        extramaterial_id=body.extramaterial_id,
        x=max(0, min(1, body.x)),
        y=max(0, min(1, body.y)),
        width=max(0, min(1, body.width)),
        height=max(0, min(1, body.height)),
        sort_order=sort_order,
    )
    now_iso = datetime.now(timezone.utc).isoformat()
    db.add(s)
    db.add(GravplatsRedigeringslogg(
        gravplats_id=gravplats_id,
        user_id=current_user.id,
        edited_at=now_iso,
        inmatning_snapshot=json.dumps({"_skiss_event": "tillagd"}),
    ))
    db.commit()
    db.refresh(s)
    return {
        "id": s.id,
        "source_type": s.source_type,
        "content_sida": s.content_sida,
        "halva": s.halva,
        "segment_index": s.segment_index,
        "extramaterial_id": s.extramaterial_id,
        "x": s.x,
        "y": s.y,
        "width": s.width,
        "height": s.height,
        "sort_order": s.sort_order,
    }


@router.put("/api/gravplats/{gravplats_id:int}/skisser/ordning")
async def put_skisser_ordning(gravplats_id: int, body: SkissOrdningBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Uppdatera ordning på skisser (drag and drop)."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    for i, skiss_id in enumerate(body.skiss_ids):
        row = db.query(GravplatsSkiss).filter(
            GravplatsSkiss.id == skiss_id,
            GravplatsSkiss.gravplats_id == gravplats_id,
        ).first()
        if row:
            row.sort_order = i
    db.commit()
    return {"ok": True}


@router.delete("/api/gravplats/{gravplats_id:int}/skisser/{skiss_id:int}")
async def delete_skiss(gravplats_id: int, skiss_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Ta bort en skiss."""
    row = db.query(GravplatsSkiss).filter(
        GravplatsSkiss.id == skiss_id,
        GravplatsSkiss.gravplats_id == gravplats_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Skissen hittades inte")
    now_iso = datetime.now(timezone.utc).isoformat()
    db.delete(row)
    db.add(GravplatsRedigeringslogg(
        gravplats_id=gravplats_id,
        user_id=current_user.id,
        edited_at=now_iso,
        inmatning_snapshot=json.dumps({"_skiss_event": "bortagen"}),
    ))
    db.commit()
    return {"ok": True}
