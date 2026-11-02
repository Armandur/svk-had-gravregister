"""Bakgrundskörning av lokala OCR-batchjobb på servern.

Lokala jobb (jobb_typ "lokal") körs av en asyncio-uppgift som startar med appen.
Den tar en grav i taget från det äldsta jobbet med status "kör", så webbläsaren
behöver inte vara öppen. Paus och avbryt sker genom att jobbets status ändras.
Uppgiften läser om status mellan varje grav.

Är modellservern upptagen eller nere läggs graven tillbaka som "väntar" och
körningen försöker igen efter en stund. Det räknas inte som fel.
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

from sqlalchemy import update

from app.database import ClaudeAnropslogg, ClaudeBatchJobb, ClaudeBatchJobbPost, Gravplats, LokalOcrSvar, SessionLocal
from app.services import modelljobb_rapport as rapport
from app.utils.text import _format_fullstandigt
from app.utils.api_keys import _get_lokal_ocr_modell
from app.services.ocr_service import LokalOcrFel, ocr_gravplats_lokal, slapp_ansprak
from app.utils.ocr_utils import _collect_png_images_for_gravplats, _spara_ocr_svar

logger = logging.getLogger(__name__)

VILA_TOMT_S = 5          # inget jobb att köra
VILA_SERVER_S = 120      # modellservern upptagen eller nere

# Senaste lägesbesked per jobb, för visning på batch-sidan. Bara i minnet.
lagesbesked: dict[int, str] = {}


class ServernOtillganglig(Exception):
    """Modellservern går inte att använda just nu. Graven ska försökas igen senare."""


def aterstall_efter_omstart() -> None:
    """Gravar som stod på "kör" när appen stoppades läggs tillbaka i kön.

    Webbläsarstyrda jobb (realtid) pausas, eftersom ingen flik driver dem längre.
    Lokala jobb behåller status "kör" och fortsätter i bakgrunden.
    """
    with SessionLocal() as db:
        poster = (
            db.query(ClaudeBatchJobbPost)
            .join(ClaudeBatchJobb, ClaudeBatchJobbPost.jobb_id == ClaudeBatchJobb.id)
            .filter(ClaudeBatchJobbPost.status == "kör", ClaudeBatchJobb.jobb_typ.in_(["realtid", "lokal"]))
            .all()
        )
        for p in poster:
            p.status = "väntar"
        realtid = db.query(ClaudeBatchJobb).filter(ClaudeBatchJobb.jobb_typ == "realtid", ClaudeBatchJobb.status == "kör").all()
        for j in realtid:
            j.status = "pausad"
        db.commit()
        if poster or realtid:
            logger.info("Återställde %d gravar och pausade %d webbläsarjobb efter omstart", len(poster), len(realtid))


def _nasta_post(db) -> ClaudeBatchJobbPost | None:
    """Nästa väntande grav i det äldsta lokala jobbet som kör. Markerar den som "kör"."""
    jobb_med_poster = (
        db.query(ClaudeBatchJobb)
        .filter(ClaudeBatchJobb.jobb_typ == "lokal", ClaudeBatchJobb.status == "kör")
        .order_by(ClaudeBatchJobb.id)
        .all()
    )
    for jobb in jobb_med_poster:
        post = (
            db.query(ClaudeBatchJobbPost)
            .filter(ClaudeBatchJobbPost.jobb_id == jobb.id, ClaudeBatchJobbPost.status == "väntar")
            .order_by(ClaudeBatchJobbPost.ordning)
            .first()
        )
        if post is None:
            jobb.status = "klar"
            lagesbesked.pop(jobb.id, None)
            db.commit()
            continue
        post.status = "kör"
        db.commit()
        return post
    return None


async def kor_ett_steg() -> bool:
    """Kör en grav. Sant om något gjordes, falskt om kön är tom.

    Kastar ServernOtillganglig när modellservern är upptagen eller nere. Graven är
    då tillbaka i kön.
    """
    with SessionLocal() as db:
        post = _nasta_post(db)
        if post is None:
            return False
        jobb = db.get(ClaudeBatchJobb, post.jobb_id)
        jobb_id, gravplats_id, user_id = jobb.id, post.gravplats_id, jobb.user_id
        lagesbesked[jobb_id] = "Kör"
        g = db.get(Gravplats, gravplats_id)
        rubrik = _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer) if g else f"gravplats {gravplats_id}"

        # Två köade jobb kan innehålla samma grav. Har ett tidigare jobb redan läst
        # den med samma modell räknas den som klar i stället för att läsas igen.
        redan = (
            db.query(LokalOcrSvar.id)
            .filter(LokalOcrSvar.gravplats_id == gravplats_id, LokalOcrSvar.modell == _get_lokal_ocr_modell(),
                    LokalOcrSvar.skapad_den >= jobb.skapad_den)
            .first()
        )
        if redan:
            post.status = "klar"
            post.fel_meddelande = None
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(klara=ClaudeBatchJobb.klara + 1))
            db.commit()
            await rapport.grav_redan_last(jobb_id, rubrik)
            return True

        try:
            bilder = await asyncio.to_thread(_bilder, gravplats_id)
        except Exception:
            logger.exception("Kunde inte rendera bilder för gravplats %s", gravplats_id)
            bilder = []
        if not bilder:
            post.status = "hoppad"
            post.fel_meddelande = "Inga bilder hittades för gravplatsen"
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
            db.commit()
            return True

        await rapport.grav_borjar(jobb_id, jobb.namn, _get_lokal_ocr_modell(), jobb.totalt, jobb.klara, rubrik)
        t0 = time.monotonic()
        try:
            result, usage = await ocr_gravplats_lokal(bilder)
        except LokalOcrFel as exc:
            meddelande = str(exc)
            if _ar_tillfalligt(meddelande):
                post.status = "väntar"
                lagesbesked[jobb_id] = f"Väntar: {meddelande}"
                db.commit()
                raise ServernOtillganglig(meddelande) from exc
            post.status = "fel"
            post.fel_meddelande = meddelande
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
            db.commit()
            await rapport.grav_fel(jobb_id, rubrik, meddelande)
            return True
        except Exception:
            logger.exception("Oväntat fel vid lokal OCR av gravplats %s", gravplats_id)
            post.status = "fel"
            post.fel_meddelande = "Oväntat fel vid körningen, se serverloggen"
            db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(fel=ClaudeBatchJobb.fel + 1))
            db.commit()
            await rapport.grav_fel(jobb_id, rubrik, post.fel_meddelande)
            return True

        db.add(ClaudeAnropslogg(
            user_id=user_id,
            gravplats_id=gravplats_id,
            anropad_den=datetime.now(timezone.utc).isoformat(),
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            kostnad_usd=0.0,
            svarstid_ms=int((time.monotonic() - t0) * 1000),
            modell=usage["modell"],
        ))
        _spara_ocr_svar(db, user_id, gravplats_id, result, usage["modell"], lokal=True, osakra=usage.get("osakra"))
        post.status = "klar"
        post.fel_meddelande = None
        db.execute(update(ClaudeBatchJobb).where(ClaudeBatchJobb.id == jobb_id).values(klara=ClaudeBatchJobb.klara + 1))
        db.commit()
        lagesbesked[jobb_id] = "Kör"
        await rapport.grav_klar(jobb_id, rubrik, result, usage.get("svar_meta"), bilder[0])
        return True


def _korande_jobb() -> set[int]:
    with SessionLocal() as db:
        return {jid for (jid,) in db.query(ClaudeBatchJobb.id).filter(ClaudeBatchJobb.jobb_typ == "lokal", ClaudeBatchJobb.status == "kör")}


def _bilder(gravplats_id: int) -> list[bytes]:
    with SessionLocal() as db:
        return _collect_png_images_for_gravplats(gravplats_id, db)


def _ar_tillfalligt(meddelande: str) -> bool:
    """Fel som går över av sig själva: servern upptagen, avstängd eller långsam."""
    return any(ord_ in meddelande for ord_ in ("upptagen", "går inte att nå", "svarade inte i tid", "växeln"))


async def korningsslinga() -> None:
    """Körs som bakgrundsuppgift så länge appen lever. Släpper anspråket när kön är tom."""
    hade_arbete = False
    while True:
        try:
            await rapport.stang_utom(_korande_jobb())
            gjorde_nagot = await kor_ett_steg()
            if gjorde_nagot:
                hade_arbete = True
            elif hade_arbete:
                await slapp_ansprak()
                hade_arbete = False
        except ServernOtillganglig as exc:
            logger.info("Lokal batch väntar på modellservern: %s", exc)
            await asyncio.sleep(VILA_SERVER_S)
            continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Oväntat fel i lokal batchkörning")
            await asyncio.sleep(VILA_SERVER_S)
            continue
        if not gjorde_nagot:
            await asyncio.sleep(VILA_TOMT_S)


MAX_INTERVALL_S = 600  # längre mellanrum mellan två gravar är en paus, inte takt
TAKT_FONSTER = 20      # antal senaste anrop som takten räknas på


def takt(db, jobb: ClaudeBatchJobb) -> dict | None:
    """Snitthastighet och beräknad sluttid för ett jobb som kör.

    Hastigheten är medianen av tiden mellan jobbets senaste anrop i anropsloggen.
    Medianen tål enstaka långsamma gravar, och mellanrum över tio minuter
    (pauser, omstarter) räknas inte. None tills minst tre gravar är klara.
    """
    from datetime import timedelta
    from statistics import median

    gravar = [gid for (gid,) in db.query(ClaudeBatchJobbPost.gravplats_id).filter(ClaudeBatchJobbPost.jobb_id == jobb.id)]
    if not gravar:
        return None
    tider = [
        datetime.fromisoformat(t)
        for (t,) in db.query(ClaudeAnropslogg.anropad_den)
        .filter(ClaudeAnropslogg.gravplats_id.in_(gravar), ClaudeAnropslogg.anropad_den >= jobb.skapad_den)
        .order_by(ClaudeAnropslogg.anropad_den.desc())
        .limit(TAKT_FONSTER + 1)
    ]
    intervall = [(a - b).total_seconds() for a, b in zip(tider, tider[1:])]
    intervall = [s for s in intervall if 0 < s <= MAX_INTERVALL_S]
    if len(intervall) < 2:
        return None
    sek_per_grav = median(intervall)
    kvar = (
        db.query(ClaudeBatchJobbPost)
        .filter(ClaudeBatchJobbPost.jobb_id == jobb.id, ClaudeBatchJobbPost.status.in_(["väntar", "kör"]))
        .count()
    )
    klart = datetime.now(timezone.utc) + timedelta(seconds=sek_per_grav * kvar)
    return {"sek_per_grav": round(sek_per_grav, 1), "kvar": kvar, "klart_ca": klart.isoformat()}


def _kvar(db, jobb_id: int) -> int:
    return (
        db.query(ClaudeBatchJobbPost)
        .filter(ClaudeBatchJobbPost.jobb_id == jobb_id, ClaudeBatchJobbPost.status.in_(["väntar", "kör"]))
        .count()
    )


def ko(db, jobb: ClaudeBatchJobb) -> dict | None:
    """Var ett lokalt jobb står i kön. None om det inte kör eller är först.

    Lokala jobb körs ett i taget, äldst först. Sluttiden för ett köat jobb räknar
    med gravarna i jobben före, i det aktiva jobbets takt.
    """
    from datetime import timedelta

    if jobb.jobb_typ != "lokal" or jobb.status != "kör":
        return None
    fore = (
        db.query(ClaudeBatchJobb)
        .filter(ClaudeBatchJobb.jobb_typ == "lokal", ClaudeBatchJobb.status == "kör", ClaudeBatchJobb.id < jobb.id)
        .order_by(ClaudeBatchJobb.id)
        .all()
    )
    fore = [(j, _kvar(db, j.id)) for j in fore]
    fore = [(j, n) for j, n in fore if n > 0]
    if not fore:
        return None
    gravar_fore = sum(n for _, n in fore)
    ut = {"plats": len(fore) + 1, "aktivt_jobb": fore[0][0].namn, "gravar_fore": gravar_fore}
    aktiv_takt = takt(db, fore[0][0])
    if aktiv_takt:
        sek = aktiv_takt["sek_per_grav"]
        ut["klart_ca"] = (datetime.now(timezone.utc) + timedelta(seconds=sek * (gravar_fore + _kvar(db, jobb.id)))).isoformat()
        ut["sek_per_grav"] = sek
    return ut
