"""Rutter för enskild Claude OCR."""
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.constants import _CLAUDE_PRIS
from app.database import (
    get_db,
    User,
    MappConfig,
    Extramaterial,
    Gravplats,
    GravplatsDoldHalva,
    ClaudeAnropslogg,
    ClaudeOcrSvar,
    ClaudeBatchJobb,
    ClaudeBatchJobbPost,
)
from app.auth import get_current_user
from app.services.ocr_service import ocr_gravplats_from_images
from app.utils.api_keys import _get_anthropic_api_key, _get_claude_instans_aktiv, _get_claude_batch_block_enskild
from app.utils.pdf_utils import (
    _mapp_path,
    _excluded_filenames_for_mapp,
    _expanded_effective_list,
    _content_page_to_item,
    _mapp_config_andelar,
    _blank_page_png_bytes,
    _clip_rect_for_segment,
    _redan_halva_filenames_for_mapp,
)
from app.utils.gravplats_utils import _gravplats_halvor

router = APIRouter()


@router.post("/api/ocr/gravplats/{gravplats_id:int}")
async def ocr_gravplats_endpoint(
    gravplats_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Skicka gravplatsens halvor till Claude OCR och returnera strukturerad JSON."""
    if not _get_claude_instans_aktiv():
        raise HTTPException(status_code=403, detail="Claude är inaktiverat för denna instans")
    if not getattr(current_user, "claude_aktiv", True):
        raise HTTPException(status_code=403, detail="Claude är inaktiverat för ditt konto")
    api_key = _get_anthropic_api_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="Anthropic API-nyckel saknas – sätt den under Inställningar")

    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")

    if _get_claude_batch_block_enskild():
        pagar_post = (
            db.query(ClaudeBatchJobbPost)
            .join(ClaudeBatchJobb, ClaudeBatchJobbPost.jobb_id == ClaudeBatchJobb.id)
            .filter(
                ClaudeBatchJobbPost.gravplats_id == gravplats_id,
                ClaudeBatchJobbPost.status == "väntar",
                ClaudeBatchJobb.status.in_(["väntar_svar", "kör"]),
            )
            .first()
        )
        if pagar_post:
            jobb_namn = db.query(ClaudeBatchJobb.namn).filter(ClaudeBatchJobb.id == pagar_post.jobb_id).scalar() or ""
            raise HTTPException(
                status_code=409,
                detail=f"Gravplatsen ingår i det pågående batch-jobbet \"{jobb_namn}\". Enskild körning är blockerad – ändra i Inställningar om du vill tillåta det.",
            )

    mapp_config = db.query(MappConfig).filter(MappConfig.id == g.mapp_id).first()
    if not mapp_config:
        raise HTTPException(status_code=404, detail="Mapp saknas")

    mapp_namn = mapp_config.namn
    layout_typ = getattr(mapp_config, "layout_typ", None) or "standard_3_sidor"
    dela_sidor = getattr(mapp_config, "dela_sidor", None) or "hojdled"

    foregaende = None
    if layout_typ == "standard_3_sidor":
        foregaende = (
            db.query(Gravplats)
            .filter(
                Gravplats.mapp_id == g.mapp_id,
                Gravplats.start_sida == g.start_sida - 2,
            )
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
        if getattr(r, "halva", None) == "ovre":
            return 0
        if getattr(r, "halva", None) == "nedre":
            return 1
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

    if not png_images:
        raise HTTPException(status_code=422, detail="Inga bilder hittades för gravplatsen")

    _t0 = time.monotonic()
    try:
        result, usage = await ocr_gravplats_from_images(png_images, api_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Claude API-fel: {exc}")
    svarstid_ms = int((time.monotonic() - _t0) * 1000)

    inp = usage.get("input_tokens", 0)
    out = usage.get("output_tokens", 0)
    cache_create = usage.get("cache_creation_input_tokens", 0)
    cache_read = usage.get("cache_read_input_tokens", 0)
    kostnad = (
        inp * _CLAUDE_PRIS["input"]
        + out * _CLAUDE_PRIS["output"]
        + cache_create * _CLAUDE_PRIS["cache_creation"]
        + cache_read * _CLAUDE_PRIS["cache_read"]
    ) / 1_000_000

    logg = ClaudeAnropslogg(
        user_id=current_user.id,
        gravplats_id=gravplats_id,
        anropad_den=datetime.now(timezone.utc).isoformat(),
        input_tokens=inp,
        output_tokens=out,
        cache_creation_tokens=cache_create,
        cache_read_tokens=cache_read,
        kostnad_usd=round(kostnad, 6),
        svarstid_ms=svarstid_ms,
    )
    db.add(logg)
    db.commit()

    svar_json_str = json.dumps(
        {k: v for k, v in result.items() if k != "_ocr_usage"},
        ensure_ascii=False
    )
    existing_svar = db.query(ClaudeOcrSvar).filter(ClaudeOcrSvar.gravplats_id == gravplats_id).first()
    if existing_svar:
        existing_svar.user_id = current_user.id
        existing_svar.skapad_den = datetime.now(timezone.utc).isoformat()
        existing_svar.svar_json = svar_json_str
        existing_svar.ocr_kommentar = result.get("ocr_kommentar", "")
    else:
        db.add(ClaudeOcrSvar(
            gravplats_id=gravplats_id,
            user_id=current_user.id,
            skapad_den=datetime.now(timezone.utc).isoformat(),
            svar_json=svar_json_str,
            ocr_kommentar=result.get("ocr_kommentar", ""),
        ))
    db.commit()

    result["_ocr_usage"] = {
        "input_tokens": inp,
        "output_tokens": out,
        "cache_creation_tokens": cache_create,
        "cache_read_tokens": cache_read,
        "kostnad_usd": round(kostnad, 6),
    }
    return result
