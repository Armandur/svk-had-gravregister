"""Rutter för batch-Claude OCR."""
import asyncio
import json
import random
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.constants import ANTHROPIC_BATCH_GRANS
from app.utils.api_keys import _get_claude_pris
from app.database import (
    get_db,
    User,
    MappConfig,
    Gravplats,
    GravplatsInmatning,
    ClaudeAnropslogg,
    ClaudeOcrSvar,
    LokalOcrSvar,
    ClaudeBatchJobb,
    ClaudeBatchJobbPost,
)
from app.auth import get_current_user
from app.schemas import BatchJobbBody
from app.services.ocr_service import ocr_gravplats_from_images
from app.utils.api_keys import _get_anthropic_api_key
from app.utils.api_keys import _get_claude_model, _get_lokal_ocr_modell
from app.services import batch_korning
from app.utils.ocr_utils import (
    _collect_png_images_for_gravplats,
    _require_batch_atkomst,
    _require_batch_motor,
    _require_claude_batch,
    _spara_ocr_svar,
)
from app.utils.text import _ledande_tal

router = APIRouter()


@router.post("/api/batch-claude/jobb")
async def skapa_batch_jobb(
    body: BatchJobbBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Skapa ett nytt batch-jobb (Claude eller lokal modell)."""
    _require_batch_motor(current_user, body.motor)
    q = db.query(Gravplats)
    if body.kyrkogard:
        q = q.filter(Gravplats.kyrkogard == body.kyrkogard)
    if body.kvarter:
        q = q.filter(Gravplats.kvarter == body.kvarter)
    if body.ej_transkriberade:
        fardigtranskriberade_ids = [r[0] for r in db.query(GravplatsInmatning.gravplats_id).filter(GravplatsInmatning.fardigtranskriberad == True).all()]
        if fardigtranskriberade_ids:
            q = q.filter(~Gravplats.id.in_(fardigtranskriberade_ids))
    if body.ej_claude_korda:
        # Hoppa över gravar som redan har svar från samma motor (lokalt: samma modell).
        if body.motor == "lokal":
            korda_ids = [r[0] for r in db.query(LokalOcrSvar.gravplats_id).filter(LokalOcrSvar.modell == _get_lokal_ocr_modell())]
        else:
            korda_ids = [r[0] for r in db.query(ClaudeOcrSvar.gravplats_id).all()]
        if korda_ids:
            q = q.filter(~Gravplats.id.in_(korda_ids))
    gravplatser = q.all()
    gravplatser.sort(key=lambda gp: (
        (gp.kyrkogard or "").lower(),
        (gp.kvarter or "").lower(),
        _ledande_tal(gp.gravplatsnummer or ""),
        (gp.gravplatsnummer or ""),
    ))
    if body.antal is not None and body.antal > 0:
        gravplatser = gravplatser[:body.antal]
    if not gravplatser:
        raise HTTPException(status_code=404, detail="Inga gravplatser matchar filtret")
    namn = body.namn.strip() or (
        (body.kyrkogard or "") + (" " + body.kvarter if body.kvarter else "")
        + (" " + str(body.antal) + " st" if body.antal else "")
        + " " + datetime.now().strftime("%Y-%m-%d")
    ).strip()
    if body.motor == "lokal":
        jobb_typ = "lokal"
    else:
        jobb_typ = "anthropic_batch" if (len(gravplatser) >= ANTHROPIC_BATCH_GRANS or body.tvinga_batch) else "realtid"
    jobb = ClaudeBatchJobb(
        user_id=current_user.id,
        namn=namn,
        skapad_den=datetime.now(timezone.utc).isoformat(),
        status="kör" if jobb_typ == "lokal" else "klar",  # lokala jobb körs direkt av bakgrundsuppgiften
        totalt=len(gravplatser),
        klara=0,
        fel=0,
        filter_json=json.dumps({"kyrkogard": body.kyrkogard, "kvarter": body.kvarter, "antal": body.antal, "ej_transkriberade": body.ej_transkriberade, "ej_claude_korda": body.ej_claude_korda}, ensure_ascii=False),
        jobb_typ=jobb_typ,
    )
    db.add(jobb)
    db.flush()
    for i, gp in enumerate(gravplatser):
        db.add(ClaudeBatchJobbPost(jobb_id=jobb.id, gravplats_id=gp.id, ordning=i, status="väntar"))
    db.commit()
    db.refresh(jobb)
    return {"id": jobb.id, "namn": jobb.namn, "totalt": jobb.totalt, "jobb_typ": jobb_typ}


@router.get("/api/batch-claude/uppskattning")
async def uppskattning_batch_jobb(
    kyrkogard: str | None = Query(default=None),
    kvarter: str | None = Query(default=None),
    antal: int | None = Query(default=None),
    ej_transkriberade: bool = Query(default=True),
    ej_claude_korda: bool = Query(default=True),
    motor: str = Query(default="claude", pattern="^(claude|lokal)$"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Räkna gravplatser per kvartertyp utan att skapa ett jobb – för kostnadsuppskattning."""
    _require_batch_motor(current_user, motor)
    q = db.query(Gravplats)
    if kyrkogard:
        q = q.filter(Gravplats.kyrkogard == kyrkogard)
    if kvarter:
        q = q.filter(Gravplats.kvarter == kvarter)
    if ej_transkriberade:
        fardigtranskriberade_ids = [r[0] for r in db.query(GravplatsInmatning.gravplats_id).filter(GravplatsInmatning.fardigtranskriberad == True).all()]
        if fardigtranskriberade_ids:
            q = q.filter(~Gravplats.id.in_(fardigtranskriberade_ids))
    if ej_claude_korda:
        korda_ids = [r[0] for r in db.query(ClaudeOcrSvar.gravplats_id).all()]
        if korda_ids:
            q = q.filter(~Gravplats.id.in_(korda_ids))
    gravplatser = q.with_entities(Gravplats.kvarter).all()
    if antal is not None and antal > 0:
        gravplatser = gravplatser[:antal]
    allm = sum(1 for (kv,) in gravplatser if kv and "allm" in kv.lower())
    ovriga = len(gravplatser) - allm
    return {"allm": allm, "ovriga": ovriga, "totalt": len(gravplatser)}


@router.get("/api/batch-claude/gravplats/{gravplats_id:int}/pagar")
async def gravplats_i_pagar_batch(
    gravplats_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Kontrollera om en gravplats ingår i ett pågående batch-jobb."""
    post_jobb = (
        db.query(ClaudeBatchJobbPost, ClaudeBatchJobb)
        .join(ClaudeBatchJobb, ClaudeBatchJobbPost.jobb_id == ClaudeBatchJobb.id)
        .filter(
            ClaudeBatchJobbPost.gravplats_id == gravplats_id,
            ClaudeBatchJobbPost.status == "väntar",
            ClaudeBatchJobb.status.in_(["väntar_svar", "kör"]),
        )
        .first()
    )
    if not post_jobb:
        return {"pagar": False}
    _, jobb = post_jobb
    return {
        "pagar": True,
        "jobb_id": jobb.id,
        "jobb_namn": jobb.namn,
        "skapad_den": jobb.skapad_den,
        "status": jobb.status,
    }


@router.get("/api/batch-claude/jobb")
async def lista_batch_jobb(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Lista användarens batch-jobb."""
    _require_batch_atkomst(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.user_id == current_user.id).order_by(ClaudeBatchJobb.skapad_den.desc()).all()
    return {"jobb": [{"id": j.id, "namn": j.namn, "skapad_den": j.skapad_den, "status": j.status, "totalt": j.totalt, "klara": j.klara, "fel": j.fel, "jobb_typ": j.jobb_typ,
                      "takt": batch_korning.takt(db, j) if j.status == "kör" else None,
                      "ko": batch_korning.ko(db, j)} for j in jobb]}


@router.get("/api/batch-claude/jobb/{jobb_id:int}")
async def hamta_batch_jobb(
    jobb_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hämta detaljer och poster för ett batch-jobb."""
    _require_batch_atkomst(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    poster = db.query(ClaudeBatchJobbPost).filter(ClaudeBatchJobbPost.jobb_id == jobb_id).order_by(ClaudeBatchJobbPost.ordning).all()
    gravplats_ids = [p.gravplats_id for p in poster]
    gravplatser_rows = (
        db.query(Gravplats, MappConfig.namn)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .filter(Gravplats.id.in_(gravplats_ids))
        .all()
    ) if gravplats_ids else []
    gravplatser = {g.id: (g, mapp_namn) for g, mapp_namn in gravplatser_rows}
    poster_data = []
    for p in poster:
        pair = gravplatser.get(p.gravplats_id)
        gp, mapp_namn = pair if pair else (None, None)
        poster_data.append({
            "id": p.id,
            "gravplats_id": p.gravplats_id,
            "ordning": p.ordning,
            "status": p.status,
            "fel_meddelande": p.fel_meddelande or None,
            "kyrkogard": gp.kyrkogard if gp else None,
            "kvarter": gp.kvarter if gp else None,
            "gravplatsnummer": gp.gravplatsnummer if gp else None,
            "mapp_namn": mapp_namn if mapp_namn else None,
        })
    return {
        "id": jobb.id, "namn": jobb.namn, "skapad_den": jobb.skapad_den,
        "status": jobb.status, "totalt": jobb.totalt, "klara": jobb.klara, "fel": jobb.fel,
        "jobb_typ": jobb.jobb_typ,
        "lagesbesked": batch_korning.lagesbesked.get(jobb.id) if jobb.status == "kör" else None,
        "takt": batch_korning.takt(db, jobb) if jobb.status == "kör" else None,
        "ko": batch_korning.ko(db, jobb),
        "poster": poster_data,
    }


@router.get("/api/batch-claude/jobb/{jobb_id:int}/poster")
async def hamta_batch_jobb_poster(
    jobb_id: int,
    sida: int = 1,
    per_sida: int = 25,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hämta paginerad lista av poster för ett batch-jobb."""
    _require_batch_atkomst(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    per_sida = max(1, min(100, per_sida))
    sida = max(1, sida)
    totalt = db.query(ClaudeBatchJobbPost).filter(ClaudeBatchJobbPost.jobb_id == jobb_id).count()
    poster = (
        db.query(ClaudeBatchJobbPost)
        .filter(ClaudeBatchJobbPost.jobb_id == jobb_id)
        .order_by(ClaudeBatchJobbPost.ordning)
        .offset((sida - 1) * per_sida)
        .limit(per_sida)
        .all()
    )
    gravplats_ids = [p.gravplats_id for p in poster]
    gravplatser_rows = (
        db.query(Gravplats, MappConfig.namn)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .filter(Gravplats.id.in_(gravplats_ids))
        .all()
    ) if gravplats_ids else []
    gravplatser = {g.id: (g, mapp_namn) for g, mapp_namn in gravplatser_rows}
    poster_data = []
    for p in poster:
        pair = gravplatser.get(p.gravplats_id)
        gp, mapp_namn = pair if pair else (None, None)
        poster_data.append({
            "id": p.id,
            "gravplats_id": p.gravplats_id,
            "ordning": p.ordning,
            "status": p.status,
            "fel_meddelande": p.fel_meddelande or None,
            "kyrkogard": gp.kyrkogard if gp else None,
            "kvarter": gp.kvarter if gp else None,
            "gravplatsnummer": gp.gravplatsnummer if gp else None,
            "mapp_namn": mapp_namn if mapp_namn else None,
        })
    sidor = max(1, -(-totalt // per_sida))
    return {"poster": poster_data, "totalt": totalt, "sida": sida, "per_sida": per_sida, "sidor": sidor}


@router.delete("/api/batch-claude/jobb/{jobb_id:int}")
async def ta_bort_batch_jobb(
    jobb_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Ta bort ett batch-jobb (och dess poster)."""
    _require_batch_atkomst(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    db.query(ClaudeBatchJobbPost).filter(ClaudeBatchJobbPost.jobb_id == jobb_id).delete()
    db.delete(jobb)
    db.commit()
    return {"ok": True}


@router.post("/api/batch-claude/jobb/{jobb_id:int}/nasta")
async def batch_kor_nasta(
    jobb_id: int,
    antal: int = Query(default=1, ge=1, le=5),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Kör OCR parallellt på nästa `antal` väntande poster. Lokala jobb körs en post i taget."""
    _require_batch_atkomst(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    if jobb.jobb_typ == "lokal":
        raise HTTPException(status_code=409, detail="Jobbet körs i bakgrunden på servern.")
    _require_claude_batch(current_user)
    if jobb.status == "avbruten":
        raise HTTPException(status_code=400, detail="Jobbet är avbrutet")
    poster = (
        db.query(ClaudeBatchJobbPost)
        .filter(ClaudeBatchJobbPost.jobb_id == jobb_id, ClaudeBatchJobbPost.status == "väntar")
        .order_by(ClaudeBatchJobbPost.ordning)
        .limit(antal)
        .all()
    )
    if not poster:
        jobb.status = "klar"
        db.commit()
        return Response(status_code=204)
    for p in poster:
        p.status = "kör"
    jobb.status = "kör"
    db.commit()
    api_key = _get_anthropic_api_key()

    async def kör_en(post: ClaudeBatchJobbPost) -> None:
        gravplats_id = post.gravplats_id
        try:
            png_images = _collect_png_images_for_gravplats(gravplats_id, db)
        except Exception:
            png_images = []
        if not png_images:
            post.status = "hoppad"
            post.fel_meddelande = "Inga bilder hittades för gravplatsen"
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
            db.commit()
            return
        max_forsok = 3
        for forsok in range(max_forsok):
            try:
                _t0 = time.monotonic()
                result, usage = await ocr_gravplats_from_images(png_images, api_key)
                svarstid_ms = int((time.monotonic() - _t0) * 1000)
                inp = usage.get("input_tokens", 0)
                out = usage.get("output_tokens", 0)
                cache_create = usage.get("cache_creation_input_tokens", 0)
                cache_read = usage.get("cache_read_input_tokens", 0)
                pris = _get_claude_pris()
                kostnad = (inp * pris["input"] + out * pris["output"] + cache_create * pris["cache_creation"] + cache_read * pris["cache_read"]) / 1_000_000
                db.add(ClaudeAnropslogg(
                    user_id=current_user.id,
                    gravplats_id=gravplats_id,
                    anropad_den=datetime.now(timezone.utc).isoformat(),
                    input_tokens=inp, output_tokens=out,
                    cache_creation_tokens=cache_create, cache_read_tokens=cache_read,
                    kostnad_usd=round(kostnad, 6),
                    svarstid_ms=svarstid_ms,
                ))
                _spara_ocr_svar(db, current_user.id, gravplats_id, result, _get_claude_model())
                post.status = "klar"
                post.fel_meddelande = None
                db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(klara=ClaudeBatchJobb.klara + 1))
                db.commit()
                return
            except Exception as exc:
                meddelande = str(exc) or "Okänt fel"
                ar_rate_limit = "429" in meddelande
                if ar_rate_limit and forsok < max_forsok - 1:
                    vantetid = 60 * (forsok + 1) + random.uniform(0, 20)
                    await asyncio.sleep(vantetid)
                    continue
                post.status = "fel"
                post.fel_meddelande = meddelande
                db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
                db.commit()
                return

    await asyncio.gather(*[kör_en(p) for p in poster])
    db.refresh(jobb)
    kvar = db.query(ClaudeBatchJobbPost).filter(ClaudeBatchJobbPost.jobb_id == jobb_id, ClaudeBatchJobbPost.status == "väntar").count()
    if kvar == 0:
        jobb.status = "klar"
        db.commit()
    senaste_fel_post = (
        db.query(ClaudeBatchJobbPost)
        .filter(
            ClaudeBatchJobbPost.jobb_id == jobb_id,
            ClaudeBatchJobbPost.status.in_(["fel", "hoppad"]),
            ClaudeBatchJobbPost.fel_meddelande.isnot(None),
        )
        .order_by(ClaudeBatchJobbPost.id.desc())
        .first()
    )
    senaste_fel = senaste_fel_post.fel_meddelande if senaste_fel_post else None
    return {"klara": jobb.klara, "totalt": jobb.totalt, "kvar": kvar, "fel": jobb.fel, "senaste_fel": senaste_fel,
            "takt": batch_korning.takt(db, jobb)}


@router.post("/api/batch-claude/jobb/{jobb_id:int}/starta")
async def batch_starta_lokal(
    jobb_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Starta eller återuppta ett lokalt jobb. Bakgrundsuppgiften tar det inom några sekunder."""
    _require_batch_motor(current_user, "lokal")
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    if jobb.jobb_typ != "lokal":
        raise HTTPException(status_code=400, detail="Bara jobb med lokal modell körs i bakgrunden.")
    if jobb.status == "avbruten":
        raise HTTPException(status_code=400, detail="Jobbet är avbrutet")
    jobb.status = "kör"
    db.commit()
    return {"ok": True, "status": jobb.status}


@router.post("/api/batch-claude/jobb/{jobb_id:int}/pausa")
async def batch_pausa(
    jobb_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Sätt jobbets status till pausad."""
    _require_batch_atkomst(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    if jobb.status in ("kör", "klar"):
        jobb.status = "pausad"
        db.commit()
    return {"ok": True, "status": jobb.status}


@router.post("/api/batch-claude/jobb/{jobb_id:int}/avbryt")
async def batch_avbryt(
    jobb_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Avbryt ett jobb permanent."""
    _require_batch_atkomst(current_user)
    jobb = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.id == jobb_id, ClaudeBatchJobb.user_id == current_user.id).first()
    if not jobb:
        raise HTTPException(status_code=404, detail="Jobbet hittades inte")
    db.query(ClaudeBatchJobbPost).filter(
        ClaudeBatchJobbPost.jobb_id == jobb_id,
        ClaudeBatchJobbPost.status == "väntar"
    ).update({"status": "hoppad"})
    jobb.status = "avbruten"
    db.commit()
    return {"ok": True, "status": jobb.status}
