"""Rapporterar lokala batchjobb till portalens /modelljobb: förlopp, sluttid och previews.

Ett jobb i appen blir ett jobb i portalen. Varje grav ger en rad i förloppet
och en preview med kortets framsida och modellens svar. Rapporteringen är
en bekvämlighet: svarar inte portalen fortsätter körningen som vanligt.

Portalen är samma som växeln (LOKAL_OCR_URL slutar på /api/ollama/active).
Pekar appen direkt på en modellserver rapporteras inget.

Klientens anrop är synkrona, så de körs i en egen tråd för att inte stoppa
appens övriga anrop.
"""
import asyncio
import json
import logging
import urllib.request

import fitz

from app.services.ocr_service import OCR_INSTRUKTION, ansprak_agare
from app.utils.api_keys import _get_lokal_ocr_url
from app.utils.modelljobb import Jobb

logger = logging.getLogger(__name__)

_VAXEL_SUFFIX = "/api/ollama/active"
_PREVIEW_MAX_PX = 960

# Öppna rapporter per batchjobb i appen: {jobb_id: (Jobb, modell)}
_rapporter: dict[int, tuple[Jobb, str]] = {}


def _portal() -> str | None:
    url = _get_lokal_ocr_url().rstrip("/")
    return url[: -len(_VAXEL_SUFFIX)] if url.endswith(_VAXEL_SUFFIX) else None


def _forhandsbild(png: bytes) -> bytes | None:
    """Kortbilden nedskalad till JPEG, så den ryms i portalens gräns på 200 kB."""
    try:
        pix = fitz.Pixmap(png)
        skala = min(1.0, _PREVIEW_MAX_PX / max(pix.width, pix.height))
        if skala < 1.0:
            pix = fitz.Pixmap(pix, int(pix.width * skala), int(pix.height * skala), None)
        return pix.tobytes("jpeg", jpg_quality=70)
    except Exception:
        logger.warning("Kunde inte skala ner kortbilden till previewn", exc_info=True)
        return None


def _aktiv_endpoint(portal: str) -> str | None:
    """Namnet på maskinen växeln pekar på, så portalen visar jobbet under rätt maskin."""
    try:
        with urllib.request.urlopen(f"{portal}{_VAXEL_SUFFIX}", timeout=5) as svar:
            return json.loads(svar.read()).get("name")
    except (OSError, ValueError):
        return None


def _skapa(jobb_id: int, namn: str, modell: str, totalt: int, klara: int) -> tuple[Jobb, str] | None:
    portal = _portal()
    if portal is None:
        return None
    rapport = Jobb(
        f"Gravregister: {namn}",
        {modell: totalt},
        endpoint=_aktiv_endpoint(portal),
        projekt="svk-had-gravregister",
        agare=ansprak_agare(),
        prompt=OCR_INSTRUKTION,
        portal=portal,
    )
    rapport.borjar(modell, redan_klara=klara)
    return rapport, modell


async def grav_borjar(jobb_id: int, namn: str, modell: str, totalt: int, klara: int, rubrik: str) -> None:
    """Före modellanropet för en grav. Skapar portalens jobb första gången."""
    try:
        if jobb_id not in _rapporter or _rapporter[jobb_id][1] != modell:
            ny = await asyncio.to_thread(_skapa, jobb_id, namn, modell, totalt, klara)
            if ny is None:
                return
            _rapporter[jobb_id] = ny
        rapport, _ = _rapporter[jobb_id]
        await asyncio.to_thread(rapport.anrop_borjar, modell, rubrik)
    except Exception:
        logger.warning("Kunde inte rapportera till portalens modelljobb", exc_info=True)


async def grav_klar(jobb_id: int, rubrik: str, resultat: dict, svar_meta: dict | None, kortbild: bytes | None) -> None:
    """Efter ett lyckat svar: förlopp och preview."""
    if jobb_id not in _rapporter:
        return
    rapport, modell = _rapporter[jobb_id]
    try:
        await asyncio.to_thread(rapport.klar_med, modell, rubrik, svar_meta)
        bild = await asyncio.to_thread(_forhandsbild, kortbild) if kortbild else None
        svar = json.dumps(resultat, ensure_ascii=False, indent=1)
        await asyncio.to_thread(lambda: rapport.preview(modell, rubrik, svar=svar, indata_bild=bild,
                                                        format="json", svar_meta=svar_meta))
    except Exception:
        logger.warning("Kunde inte rapportera till portalens modelljobb", exc_info=True)


async def grav_fel(jobb_id: int, rubrik: str, meddelande: str) -> None:
    if jobb_id not in _rapporter:
        return
    rapport, modell = _rapporter[jobb_id]
    try:
        await asyncio.to_thread(rapport.klar_med, modell, rubrik)
        await asyncio.to_thread(rapport.fel, modell, f"{rubrik}: {meddelande}")
    except Exception:
        logger.warning("Kunde inte rapportera till portalens modelljobb", exc_info=True)


async def grav_redan_last(jobb_id: int, rubrik: str) -> None:
    """Graven lästes redan av ett tidigare jobb: räkna den som klar utan preview."""
    if jobb_id not in _rapporter:
        return
    rapport, modell = _rapporter[jobb_id]
    try:
        await asyncio.to_thread(rapport.klar_med, modell, rubrik)
    except Exception:
        logger.warning("Kunde inte rapportera till portalens modelljobb", exc_info=True)


async def stang_utom(korande: set[int]) -> None:
    """Avsluta portalens jobb för appjobb som inte längre kör (klara, pausade, avbrutna)."""
    for jobb_id in [j for j in _rapporter if j not in korande]:
        rapport, modell = _rapporter.pop(jobb_id)
        try:
            await asyncio.to_thread(rapport.modell_klar, modell)
            await asyncio.to_thread(rapport.avsluta)
        except Exception:
            logger.warning("Kunde inte avsluta portalens modelljobb", exc_info=True)
