"""Rutter för Anthropics Batch API: skicka ett batchjobb och hämta svaren."""
import asyncio
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import ClaudeAnropslogg, ClaudeBatchJobb, ClaudeBatchJobbPost, ClaudeOcrSvar, User, get_db
from app.services.ocr_service import (
    bygg_batch_request,
    hamta_anthropic_batch_resultat,
    poll_anthropic_batch,
    skicka_anthropic_batch,
)
from app.utils.api_keys import _get_anthropic_api_key, _get_claude_pris
from app.utils.ocr_utils import _collect_all_batch_images_sync, _require_claude_batch

router = APIRouter()


@router.post("/api/batch-claude/jobb/{jobb_id:int}/skicka-anthropic")
async def batch_skicka_anthropic(
    jobb_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Samla bilder för alla gravar i jobbet och skicka till Anthropics Batch API."""
    _require_claude_batch(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    if jobb.jobb_typ != "anthropic_batch":
        raise HTTPException(status_code=400, detail="Jobbet är inte av typ anthropic_batch")
    if jobb.status not in ("klar", "fel"):
        raise HTTPException(status_code=400, detail=f"Jobbet har fel status: {jobb.status}")
    api_key = _get_anthropic_api_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="Anthropic API-nyckel saknas")
    if jobb.status == "fel":
        db.query(ClaudeBatchJobbPost).filter(
            ClaudeBatchJobbPost.jobb_id == jobb_id,
            ClaudeBatchJobbPost.status == "hoppad",
        ).update({"status": "väntar", "fel_meddelande": None})
        jobb.fel = 0
        db.commit()
    poster = (
        db.query(ClaudeBatchJobbPost)
        .filter(ClaudeBatchJobbPost.jobb_id == jobb_id, ClaudeBatchJobbPost.status == "väntar")
        .order_by(ClaudeBatchJobbPost.ordning)
        .all()
    )
    if not poster:
        raise HTTPException(status_code=400, detail="Inga väntande poster i jobbet")
    jobb.status = "kör"
    db.commit()
    post_data = [(p.id, p.gravplats_id) for p in poster]
    images_by_post_id = await asyncio.to_thread(_collect_all_batch_images_sync, post_data)
    batch_requests = []
    for post in poster:
        png_images = images_by_post_id.get(post.id, [])
        if not png_images:
            post.status = "hoppad"
            post.fel_meddelande = "Inga bilder hittades för gravplatsen"
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
            db.commit()
            continue
        batch_requests.append(bygg_batch_request(f"post-{post.id}", png_images))
    if not batch_requests:
        jobb.status = "fel"
        db.commit()
        raise HTTPException(status_code=400, detail="Inga gravar med bilder kunde förberedas")
    try:
        anthropic_batch_id = await skicka_anthropic_batch(batch_requests, api_key)
    except Exception as exc:
        jobb.status = "fel"
        db.commit()
        raise HTTPException(status_code=502, detail=f"Kunde inte skicka till Anthropic: {exc}")
    jobb.anthropic_batch_id = anthropic_batch_id
    jobb.status = "väntar_svar"
    db.commit()
    return {"anthropic_batch_id": anthropic_batch_id, "skickade": len(batch_requests)}


@router.post("/api/batch-claude/jobb/{jobb_id:int}/poll-anthropic")
async def batch_poll_anthropic(
    jobb_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Kontrollera status för ett Anthropic-batch-jobb. Hämtar och sparar resultat om klart."""
    _require_claude_batch(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    if jobb.jobb_typ != "anthropic_batch":
        raise HTTPException(status_code=400, detail="Jobbet är inte av typ anthropic_batch")
    if not jobb.anthropic_batch_id:
        raise HTTPException(status_code=400, detail="Batch-ID saknas – har jobbet skickats?")
    api_key = _get_anthropic_api_key()
    if not api_key:
        raise HTTPException(status_code=500, detail="Anthropic API-nyckel saknas")
    try:
        status_info = await poll_anthropic_batch(jobb.anthropic_batch_id, api_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kunde inte kontrollera Anthropic-status: {exc}")
    processing_status = status_info.get("processing_status")
    request_counts = status_info.get("request_counts", {})
    if processing_status != "ended":
        return {
            "processing_status": processing_status,
            "request_counts": request_counts,
            "klara": jobb.klara,
            "totalt": jobb.totalt,
            "status": jobb.status,
        }
    try:
        resultat = await hamta_anthropic_batch_resultat(jobb.anthropic_batch_id, api_key)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Kunde inte hämta resultat från Anthropic: {exc}")
    poster_map = {
        p.id: p
        for p in db.query(ClaudeBatchJobbPost).filter(ClaudeBatchJobbPost.jobb_id == jobb_id).all()
    }
    for rad in resultat:
        custom_id = rad.get("custom_id", "")
        result = rad.get("result", {})
        try:
            post_id = int(custom_id.split("-", 1)[1])
        except (IndexError, ValueError):
            continue
        post = poster_map.get(post_id)
        if not post:
            continue
        if result.get("type") != "succeeded":
            post.status = "fel"
            post.fel_meddelande = result.get("error", {}).get("message", "Okänt fel från Anthropic")
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
            db.commit()
            continue
        message = result.get("message", {})
        text = "".join(
            b["text"] for b in message.get("content", []) if b.get("type") == "text"
        ).strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        try:
            parsed = json.loads(text)
        except Exception:
            post.status = "fel"
            post.fel_meddelande = "Kunde inte parsa JSON från Anthropic-svar"
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
            db.commit()
            continue
        usage = message.get("usage", {})
        inp = usage.get("input_tokens", 0)
        out = usage.get("output_tokens", 0)
        cache_create = usage.get("cache_creation_input_tokens", 0)
        cache_read = usage.get("cache_read_input_tokens", 0)
        pris = _get_claude_pris()
        kostnad = (
            inp * pris["input"] + out * pris["output"]
            + cache_create * pris["cache_creation"] + cache_read * pris["cache_read"]
        ) / 1_000_000
        kostnad *= 0.5
        db.add(ClaudeAnropslogg(
            user_id=current_user.id,
            gravplats_id=post.gravplats_id,
            anropad_den=datetime.now(timezone.utc).isoformat(),
            input_tokens=inp, output_tokens=out,
            cache_creation_tokens=cache_create, cache_read_tokens=cache_read,
            kostnad_usd=round(kostnad, 6),
        ))
        svar_json_str = json.dumps({k: v for k, v in parsed.items() if k != "_ocr_usage"}, ensure_ascii=False)
        existing_svar = db.query(ClaudeOcrSvar).filter(ClaudeOcrSvar.gravplats_id == post.gravplats_id).first()
        if existing_svar:
            existing_svar.user_id = current_user.id
            existing_svar.skapad_den = datetime.now(timezone.utc).isoformat()
            existing_svar.svar_json = svar_json_str
            existing_svar.ocr_kommentar = parsed.get("ocr_kommentar", "")
        else:
            db.add(ClaudeOcrSvar(
                gravplats_id=post.gravplats_id, user_id=current_user.id,
                skapad_den=datetime.now(timezone.utc).isoformat(),
                svar_json=svar_json_str, ocr_kommentar=parsed.get("ocr_kommentar", ""),
            ))
        post.status = "klar"
        post.fel_meddelande = None
        db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(klara=ClaudeBatchJobb.klara + 1))
        db.commit()
    db.refresh(jobb)
    jobb.status = "klar"
    db.commit()
    return {
        "processing_status": "ended",
        "request_counts": request_counts,
        "klara": jobb.klara,
        "totalt": jobb.totalt,
        "fel": jobb.fel,
        "status": jobb.status,
    }
