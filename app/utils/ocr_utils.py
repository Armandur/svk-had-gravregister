"""OCR-hjälpfunktioner: bildsamling för gravplatser och batch-körning."""
import fitz  # PyMuPDF
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.utils.api_keys import _get_anthropic_api_key, _get_claude_instans_aktiv
from app.utils.pdf_utils import (
    _gravplats_halvor_from_utils,
    _excluded_filenames_for_mapp,
    _expanded_effective_list,
    _content_page_to_item,
    _mapp_config_andelar,
    _blank_page_png_bytes,
    _clip_rect_for_segment,
    _redan_halva_filenames_for_mapp,
    _mapp_path,
)


def _collect_png_images_for_gravplats(gravplats_id: int, db: Session) -> list[bytes]:
    """Samla PNG-bilder för en gravplats (samma logik som ocr_gravplats_endpoint)."""
    from app.database import Gravplats, MappConfig, Extramaterial, GravplatsDoldHalva
    from app.utils.gravplats_utils import _gravplats_halvor
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        return []
    mapp_config = db.query(MappConfig).filter(MappConfig.id == g.mapp_id).first()
    if not mapp_config:
        return []
    mapp_namn = mapp_config.namn
    layout_typ = getattr(mapp_config, "layout_typ", None) or "standard_3_sidor"
    dela_sidor = getattr(mapp_config, "dela_sidor", None) or "hojdled"
    foregaende = None
    if layout_typ == "standard_3_sidor":
        foregaende = (
            db.query(Gravplats)
            .filter(Gravplats.mapp_id == g.mapp_id, Gravplats.start_sida == g.start_sida - 2)
            .first()
        )
    halvor = _gravplats_halvor(g, foregaende, layout_typ=layout_typ)
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    for h in halvor:
        sid = h.get("content_sida")
        if sid is not None and 1 <= sid <= len(expanded):
            item = expanded[sid - 1]
            if item.get("t") == "f":
                h["filnamn"] = item["v"]
    for em in (
        db.query(Extramaterial)
        .filter(
            Extramaterial.mapp_id == mapp_config.id,
            Extramaterial.grav_start_sida == g.start_sida,
            Extramaterial.redan_halva == True,
            Extramaterial.dold != True,
        )
        .order_by(Extramaterial.id)
    ):
        halvor.append({"redan_halva": True, "filnamn": em.filnamn})
    dold_halvor_rows = db.query(GravplatsDoldHalva).filter(GravplatsDoldHalva.gravplats_id == g.id).all()

    def _dold_seg(r):
        if getattr(r, "halva", None) == "ovre": return 0
        if getattr(r, "halva", None) == "nedre": return 1
        return getattr(r, "segment_index", 0)

    dold_set = {(r.content_sida, _dold_seg(r)) for r in dold_halvor_rows}
    halvor = [h for h in halvor if (h.get("content_sida"), h.get("segment_index", 0)) not in dold_set]
    redan_halva_set = _redan_halva_filenames_for_mapp(db, mapp_config.id)
    png_images: list[bytes] = []
    for h in halvor:
        if h.get("redan_halva"):
            filnamn = h.get("filnamn")
            if filnamn:
                path = _mapp_path(mapp_namn) / filnamn
                if path.is_file():
                    doc = fitz.open(path)
                    try:
                        pix = doc[0].get_pixmap(dpi=200)
                        png_images.append(pix.tobytes("png"))
                    finally:
                        doc.close()
            continue
        sid = h.get("content_sida")
        if sid is None:
            continue
        item = _content_page_to_item(mapp_namn, excluded, sid, db)
        if item is None:
            continue
        typ, val = item
        position = h.get("position")
        andelar = _mapp_config_andelar(mapp_config, position=position)
        segment_index = h.get("segment_index", 0)
        if typ == "blank":
            use_halva = "ovre" if segment_index == 0 else "nedre"
            use_split = andelar[0] if andelar else 0.5
            png_images.append(_blank_page_png_bytes(dpi=200, split=use_split, halva=use_halva))
            continue
        doc = fitz.open(val)
        try:
            page = doc[0]
            if val.name in redan_halva_set or dela_sidor == "ingen":
                pix = page.get_pixmap(dpi=200)
            else:
                clip = _clip_rect_for_segment(page.rect, segment_index, andelar, dela_sidor)
                pix = page.get_pixmap(dpi=200, clip=clip) if clip is not None else page.get_pixmap(dpi=200)
            png_images.append(pix.tobytes("png"))
        finally:
            doc.close()
    return png_images


def _collect_all_batch_images_sync(post_data: list[tuple[int, int]]) -> dict[int, list[bytes]]:
    """Samla PNG-bilder för en lista (post_id, gravplats_id) i en bakgrundstråd med egen DB-session."""
    from app.database import SessionLocal
    result: dict[int, list[bytes]] = {}
    with SessionLocal() as db:
        for post_id, gravplats_id in post_data:
            try:
                result[post_id] = _collect_png_images_for_gravplats(gravplats_id, db)
            except Exception:
                result[post_id] = []
    return result


def _require_claude_batch(current_user) -> None:
    """Kasta 403 om batch-Claude inte är tillgängligt för användaren."""
    from app.utils.api_keys import _get_claude_instans_aktiv, _get_anthropic_api_key
    if not _get_claude_instans_aktiv():
        raise HTTPException(status_code=403, detail="Claude är inaktiverat för denna instans")
    if not getattr(current_user, "claude_aktiv", True):
        raise HTTPException(status_code=403, detail="Claude är inaktiverat för ditt konto")
    if not getattr(current_user, "claude_batch_aktiv", False):
        raise HTTPException(status_code=403, detail="Claude batch är inte aktiverat för ditt konto")
    if not _get_anthropic_api_key():
        raise HTTPException(status_code=500, detail="Anthropic API-nyckel saknas")
