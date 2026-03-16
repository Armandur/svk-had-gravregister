"""Rutter för extramaterial, sida-redan-halva, infogade tomma sidor och filordning."""
import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.constants import CACHE_HEADERS
from app.database import (
    get_db,
    User,
    MappConfig,
    Extramaterial,
    InfogadTomSida,
    MappFilOrdning,
    MappSidaRedanHalva,
)
from app.auth import get_current_user
from app.schemas import (
    ExtramaterialSchema,
    ExtramaterialPatchSchema,
    SidaRedanHalvaSchema,
    InfogaTomSidaSchema,
    FlyttaSidaSchema,
)
from app.utils.pdf_utils import (
    _mapp_path,
    _excluded_filenames_for_mapp,
    _expanded_effective_list,
    _content_page_1based_in_expanded,
    _ordered_pdf_names,
    _shift_grav_start_efter_tillagg,
    _shift_grav_start_efter_borttag,
)

router = APIRouter()


@router.get("/api/mappar/{mapp_namn}/extramaterial")
async def list_extramaterial(mapp_namn: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lista alla extramaterial för mappen."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return {"extramaterial": []}
    items = db.query(Extramaterial).filter(Extramaterial.mapp_id == mapp_config.id).all()
    return {
        "extramaterial": [
            {
                "id": em.id,
                "filnamn": em.filnamn,
                "typ": em.typ,
                "grav_start_sida": em.grav_start_sida,
                "redan_halva": getattr(em, "redan_halva", False),
                "kommentar": getattr(em, "kommentar", None) or "",
            }
            for em in items
        ],
    }


@router.get("/api/mappar/{mapp_namn}/extramaterial-mapp")
async def list_extramaterial_mapp(mapp_namn: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lista extramaterial knutet enbart till mappen (inte till specifik grav)."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return {"extramaterial": []}
    items = (
        db.query(Extramaterial)
        .filter(Extramaterial.mapp_id == mapp_config.id, Extramaterial.grav_start_sida.is_(None))
        .all()
    )
    return {
        "extramaterial": [
            {
                "id": em.id,
                "filnamn": em.filnamn,
                "typ": em.typ,
                "redan_halva": getattr(em, "redan_halva", False),
                "kommentar": getattr(em, "kommentar", None) or "",
            }
            for em in items
        ],
    }


@router.get("/api/mappar/{mapp_namn}/fil/{filnamn}/bild")
async def pdf_fil_sida_bild(mapp_namn: str, filnamn: str):
    """Returnera första sidan av en PDF-fil som PNG (hela sidan)."""
    if "/" in filnamn or "\\" in filnamn or ".." in filnamn:
        raise HTTPException(status_code=400, detail="Ogiltigt filnamn")
    mapp = _mapp_path(mapp_namn)
    if not mapp.exists():
        raise HTTPException(status_code=404, detail="Mappen finns inte")
    path = (mapp / filnamn).resolve()
    if not str(path).startswith(str(mapp.resolve())) or not path.is_file():
        raise HTTPException(status_code=404, detail="Filen finns inte")
    if path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Endast PDF-filer")
    doc = fitz.open(path)
    try:
        page = doc[0]
        pix = page.get_pixmap(dpi=150)
        png_bytes = pix.tobytes("png")
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    finally:
        doc.close()


@router.get("/api/mappar/{mapp_namn}/fil/{filnamn}")
async def pdf_fil_efter_namn(mapp_namn: str, filnamn: str):
    """Returnera en PDF-fil efter filnamn."""
    if "/" in filnamn or "\\" in filnamn or ".." in filnamn:
        raise HTTPException(status_code=400, detail="Ogiltigt filnamn")
    mapp = _mapp_path(mapp_namn)
    if not mapp.exists():
        raise HTTPException(status_code=404, detail="Mappen finns inte")
    path = (mapp / filnamn).resolve()
    if not str(path).startswith(str(mapp.resolve())) or not path.is_file():
        raise HTTPException(status_code=404, detail="Filen finns inte")
    if path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Endast PDF-filer")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{path.name}"'},
    )


@router.post("/api/mappar/{mapp_namn}/extramaterial")
async def add_extramaterial(
    mapp_namn: str,
    body: ExtramaterialSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Registrera en PDF som extramaterial."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    filnamn = body.filnamn.strip()
    excluded_före = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded_före = _expanded_effective_list(mapp_namn, excluded_före, db)
    p_sida = _content_page_1based_in_expanded(filnamn, expanded_före)
    em = Extramaterial(
        mapp_id=mapp_config.id,
        filnamn=filnamn,
        typ=body.typ.strip() or None if body.typ else None,
        grav_start_sida=body.grav_start_sida,
        redan_halva=getattr(body, "redan_halva", False),
    )
    db.add(em)
    db.flush()
    if p_sida is not None:
        _shift_grav_start_efter_tillagg(db, mapp_config.id, p_sida)
    db.commit()
    db.refresh(em)
    return {
        "id": em.id,
        "filnamn": em.filnamn,
        "typ": em.typ,
        "grav_start_sida": em.grav_start_sida,
        "redan_halva": getattr(em, "redan_halva", False),
    }


@router.patch("/api/mappar/{mapp_namn}/extramaterial/{em_id}")
async def patch_extramaterial(
    mapp_namn: str,
    em_id: int,
    body: ExtramaterialPatchSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Uppdatera extramaterial (t.ex. redan_halva, dold)."""
    _mapp_path(mapp_namn)
    em = db.query(Extramaterial).filter(Extramaterial.id == em_id).first()
    if not em:
        raise HTTPException(status_code=404, detail="Extramaterial hittades inte")
    if body.redan_halva is not None:
        em.redan_halva = body.redan_halva
    if body.dold is not None:
        em.dold = body.dold
    if body.kommentar is not None:
        em.kommentar = body.kommentar
    db.commit()
    db.refresh(em)
    return {
        "id": em.id,
        "filnamn": em.filnamn,
        "typ": em.typ,
        "grav_start_sida": em.grav_start_sida,
        "redan_halva": getattr(em, "redan_halva", False),
        "dold": getattr(em, "dold", False),
        "kommentar": getattr(em, "kommentar", None) or "",
    }


@router.delete("/api/mappar/{mapp_namn}/extramaterial/{em_id}")
async def delete_extramaterial(
    mapp_namn: str,
    em_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ta bort ett extramaterial (via id)."""
    _mapp_path(mapp_namn)
    em = db.query(Extramaterial).filter(Extramaterial.id == em_id).first()
    if not em:
        raise HTTPException(status_code=404, detail="Extramaterial hittades inte")
    mapp_config_id = em.mapp_id
    filnamn = em.filnamn
    excluded_med = _excluded_filenames_for_mapp(db, mapp_namn)
    excluded_utan_denna = excluded_med - {filnamn}
    expanded_efter = _expanded_effective_list(mapp_namn, excluded_utan_denna, db)
    p_sida = _content_page_1based_in_expanded(filnamn, expanded_efter)
    db.delete(em)
    if p_sida is not None:
        _shift_grav_start_efter_borttag(db, mapp_config_id, p_sida)
    db.commit()
    return {"ok": True}


@router.delete("/api/mappar/{mapp_namn}/extramaterial-by-ref")
async def delete_extramaterial_by_ref(
    mapp_namn: str,
    filnamn: str,
    grav_start_sida: int | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ta bort ett extramaterial via filnamn och (valfritt) grav_start_sida."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        raise HTTPException(status_code=404, detail="Mappen hittades inte")
    q = db.query(Extramaterial).filter(
        Extramaterial.mapp_id == mapp_config.id,
        Extramaterial.filnamn == filnamn.strip(),
    )
    if grav_start_sida is not None:
        q = q.filter(Extramaterial.grav_start_sida == grav_start_sida)
    else:
        q = q.filter(Extramaterial.grav_start_sida.is_(None))
    em = q.first()
    if not em:
        raise HTTPException(status_code=404, detail="Extramaterial hittades inte")
    filnamn_ = em.filnamn
    excluded_med = _excluded_filenames_for_mapp(db, mapp_namn)
    excluded_utan_denna = excluded_med - {filnamn_}
    expanded_efter = _expanded_effective_list(mapp_namn, excluded_utan_denna, db)
    p_sida = _content_page_1based_in_expanded(filnamn_, expanded_efter)
    db.delete(em)
    if p_sida is not None:
        _shift_grav_start_efter_borttag(db, mapp_config.id, p_sida)
    db.commit()
    return {"ok": True}


@router.post("/api/mappar/{mapp_namn}/sida-redan-halva")
async def set_sida_redan_halva(
    mapp_namn: str,
    body: SidaRedanHalvaSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Markera eller avmarkera en sida i flödet som 'redan halva'."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    filnamn = body.filnamn.strip()
    if "/" in filnamn or "\\" in filnamn or ".." in filnamn:
        raise HTTPException(status_code=400, detail="Ogiltigt filnamn")
    existing = (
        db.query(MappSidaRedanHalva)
        .filter(MappSidaRedanHalva.mapp_id == mapp_config.id, MappSidaRedanHalva.filnamn == filnamn)
        .first()
    )
    if body.redan_halva:
        if not existing:
            db.add(MappSidaRedanHalva(mapp_id=mapp_config.id, filnamn=filnamn))
    else:
        if existing:
            db.delete(existing)
    db.commit()
    return {"ok": True, "filnamn": filnamn, "redan_halva": body.redan_halva}


@router.post("/api/mappar/{mapp_namn}/infoga-tom-sida")
async def infoga_tom_sida(
    mapp_namn: str,
    body: InfogaTomSidaSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Infoga en tom sida efter angiven PDF."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    efter = body.efter_filnamn.strip()
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    p_sida = _content_page_1based_in_expanded(efter, expanded)
    if p_sida is None:
        raise HTTPException(status_code=400, detail="Filnamnet finns inte i innehållslistan")
    row = InfogadTomSida(mapp_id=mapp_config.id, efter_filnamn=efter)
    db.add(row)
    db.flush()
    _shift_grav_start_efter_tillagg(db, mapp_config.id, p_sida)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "efter_filnamn": efter}


@router.delete("/api/mappar/{mapp_namn}/infogad-tom-sida/{blank_id}")
async def ta_bort_infogad_tom_sida(
    mapp_namn: str,
    blank_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Ta bort en infogad tom sida."""
    _mapp_path(mapp_namn)
    row = db.query(InfogadTomSida).filter(InfogadTomSida.id == blank_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Infogad tom sida hittades inte")
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config or row.mapp_id != mapp_config.id:
        raise HTTPException(status_code=404, detail="Infogad tom sida hittades inte i denna mapp")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    p_sida = None
    for i, item in enumerate(expanded):
        if item.get("t") == "b" and item.get("id") == blank_id:
            p_sida = i + 1
            break
    if p_sida is None:
        raise HTTPException(status_code=404, detail="Infogad tom sida finns inte i listan")
    db.delete(row)
    _shift_grav_start_efter_borttag(db, mapp_config.id, p_sida)
    db.commit()
    return {"ok": True}


@router.post("/api/mappar/{mapp_namn}/flytta-sida")
async def flytta_sida(
    mapp_namn: str,
    body: FlyttaSidaSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Flytta en sida vänster eller höger i ordningen."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    filnamn = body.filnamn.strip()
    riktning = body.riktning.strip().lower()
    if riktning in ("vänster", "vanster", "framåt", "framat"):
        riktning = "vänster"
    elif riktning in ("höger", "hoger", "bakåt", "bakat"):
        riktning = "höger"
    else:
        raise HTTPException(status_code=400, detail="riktning måste vara vänster eller höger")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    base_names = [n for n in _ordered_pdf_names(mapp_namn, db) if n not in excluded]
    try:
        idx = base_names.index(filnamn)
    except ValueError:
        raise HTTPException(status_code=404, detail="Filen finns inte i listan")
    if riktning == "vänster":
        if idx == 0:
            raise HTTPException(status_code=400, detail="Sidan är redan längst vänster")
        swap_idx = idx - 1
    else:
        if idx >= len(base_names) - 1:
            raise HTTPException(status_code=400, detail="Sidan är redan längst höger")
        swap_idx = idx + 1
    other = base_names[swap_idx]
    full_ordered = _ordered_pdf_names(mapp_namn, db)
    try:
        i_a = full_ordered.index(filnamn)
        i_b = full_ordered.index(other)
    except ValueError:
        raise HTTPException(status_code=404, detail="Filen finns inte i mappen")
    full_ordered[i_a], full_ordered[i_b] = full_ordered[i_b], full_ordered[i_a]
    for pos, name in enumerate(full_ordered):
        existing = db.query(MappFilOrdning).filter(
            MappFilOrdning.mapp_id == mapp_config.id,
            MappFilOrdning.filnamn == name,
        ).first()
        if existing:
            existing.position = pos
        else:
            db.add(MappFilOrdning(mapp_id=mapp_config.id, filnamn=name, position=pos))
    db.commit()
    return {"ok": True, "message": "Ordning uppdaterad – nolla cachning i gränssnittet."}
