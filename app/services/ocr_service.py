"""Skickar gravplatskortbilder till Claude och returnerar strukturerad JSON."""
import base64
import os
import json
from pathlib import Path

import httpx

from app.utils.api_keys import _get_claude_model, _get_lokal_ocr_modell, _get_lokal_ocr_url
from app.config import DATABASE_PATH
from app.utils.sakerhet import osakra_falt

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_BATCH_URL = "https://api.anthropic.com/v1/messages/batches"

_SPEC_PATH = Path(__file__).resolve().parent.parent / "prompts" / "gravregister_spec.md"


OCR_INSTRUKTION = (
    "Extrahera all data från dessa gravplatskort enligt specifikationen "
    "och returnera ENBART giltig JSON, utan förklaringar eller markdown. "
    "Lägg till ett fält 'ocr_kommentar' (sträng) med en övergripande "
    "notering om eventuella märkligheter, osäkerheter eller avvikelser "
    "du stött på – lämna tom sträng om allt är tydligt. "
    "Kommentera bara på saker som kan påverka datakvaliteten eller kräver "
    "manuell kontroll – inte på tomma fält eller förtryckt text som saknar ifyllnad."
)


def _load_spec() -> str:
    return _SPEC_PATH.read_text(encoding="utf-8")


async def ocr_gravplats_from_images(png_images: list[bytes], api_key: str) -> tuple[dict, dict]:
    """
    Skicka PNG-bilder (gravplatsens halvor) till Claude och returnera strukturerad JSON.
    Använder prompt caching för specifikationen (~90 % besparing på spec-tokens).
    """
    spec = _load_spec()

    content: list[dict] = []
    for img_bytes in png_images:
        data = base64.standard_b64encode(img_bytes).decode("utf-8")
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/png",
                "data": data,
            },
        })
    content.append({"type": "text", "text": OCR_INSTRUKTION})

    payload = {
        "model": _get_claude_model(),
        "max_tokens": 8192,
        "system": [
            {
                "type": "text",
                "text": spec,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        "messages": [{"role": "user", "content": content}],
    }

    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
        "content-type": "application/json",
    }

    async with httpx.AsyncClient(timeout=180) as client:
        resp = await client.post(ANTHROPIC_API_URL, json=payload, headers=headers)
        if not resp.is_success:
            raise ValueError(f"HTTP {resp.status_code}: {resp.text}")

    raw = resp.json()
    text = "".join(
        b["text"] for b in raw.get("content", []) if b.get("type") == "text"
    ).strip()

    # Städa bort eventuella markdown-kodblock
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    usage = raw.get("usage", {})
    return json.loads(text), usage


# ── Lokal modell (ollama) ─────────────────────────────────────────────────────

class LokalOcrFel(Exception):
    """Fel från lokal modell. Meddelandet är skrivet för slutanvändaren."""


def _rensa_json(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return text


_VAXEL_SUFFIX = "/api/ollama/active"

# Senaste anspråk som den här processen tog: (portaladress, endpointnamn). Används för att släppa det.
_senaste_ansprak: tuple[str, str] | None = None


def _orsak(exc: Exception) -> str:
    """Kort orsak för administratören, t.ex. att ett namn inte går att slå upp."""
    if isinstance(exc, httpx.ConnectError):
        return "får ingen kontakt, kontrollera att adressen går att nå från servern"
    if isinstance(exc, httpx.TimeoutException):
        return "svarade inte i tid"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return type(exc).__name__
_ANSPRAK_MINUTER = 15  # förlängs vid varje anrop, så en batch håller anspråket hela vägen


async def _lokal_bas_url(client: httpx.AsyncClient, ta_ansprak: bool = False) -> str:
    """Adressen till modellservern. Via växeln tas också ett anspråk på den aktiva servern.

    Anspråket är rådgivande: det visar andra att servern är upptagen. Har någon annan ett
    levande anspråk avbryts körningen, så den inte laddar om modellen under deras körning.
    """
    url = _get_lokal_ocr_url().rstrip("/")
    if not url:
        raise LokalOcrFel("Lokal modell är inte inställd. Be en administratör ange adressen under Inställningar.")
    if not url.endswith(_VAXEL_SUFFIX):
        return url
    try:
        resp = await client.get(url, timeout=10)
        resp.raise_for_status()
        aktiv = resp.json()
        bas = aktiv["url"].rstrip("/")
    except (httpx.HTTPError, KeyError, ValueError) as exc:
        raise LokalOcrFel(f"Kunde inte fråga växeln ({url}) vilken modellserver som är aktiv: {_orsak(exc)}") from exc
    if ta_ansprak and aktiv.get("name"):
        portal = url[: -len(_VAXEL_SUFFIX)]
        try:
            claim = await client.post(
                f"{portal}/api/ollama/endpoints/{aktiv['name']}/claim",
                json={"agare": ansprak_agare(), "minuter": _ANSPRAK_MINUTER, "notis": "OCR av gravkort"},
                timeout=10,
            )
        except httpx.HTTPError:
            claim = None  # växeln svarar inte på anspråk: kör ändå, servern själv svarade nyss
        if claim is not None and claim.status_code == 409:
            try:
                orsak = str(claim.json().get("detail") or "")
            except ValueError:
                orsak = ""
            raise LokalOcrFel("Modellservern är upptagen av en annan körning. Försök igen senare."
                              + (f" ({orsak})" if orsak else ""))
        if claim is not None and claim.is_success:
            global _senaste_ansprak
            _senaste_ansprak = (portal, aktiv["name"])
    return bas


def ansprak_agare() -> str:
    """Namnet anspråket tas i, så det syns i växeln vilken instans som kör.

    LOKAL_OCR_AGARE i miljön går först. Annars härleds namnet ur databasfilen:
    gravregister.db blir gravregister-prod och gravregister-dev.db blir gravregister-dev.
    """
    env = os.environ.get("LOKAL_OCR_AGARE", "").strip()
    if env:
        return env
    stam = DATABASE_PATH.stem
    return "gravregister-prod" if stam == "gravregister" else stam


async def slapp_ansprak() -> None:
    """Släpp processens anspråk i växeln. Portalen släpper bara om ägaren stämmer."""
    global _senaste_ansprak
    if _senaste_ansprak is None:
        return
    portal, namn = _senaste_ansprak
    _senaste_ansprak = None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.delete(f"{portal}/api/ollama/endpoints/{namn}/claim", params={"agare": ansprak_agare()})
    except httpx.HTTPError:
        pass  # anspråket löper ändå ut av sig självt inom en kvart


async def testa_lokal_server() -> dict:
    """Fråga den lokala servern vilka modeller den har. Kastar LokalOcrFel om den inte svarar."""
    async with httpx.AsyncClient(timeout=10) as client:
        bas = await _lokal_bas_url(client)
        try:
            resp = await client.get(f"{bas}/api/tags")
            resp.raise_for_status()
        except httpx.HTTPError as exc:
            raise LokalOcrFel(f"Modellservern på {bas} svarar inte ({_orsak(exc)}). Är datorn påslagen?") from exc
    modeller = sorted(m["name"] for m in resp.json().get("models", []))
    vald = _get_lokal_ocr_modell()
    return {"server": bas, "modeller": modeller, "vald_modell": vald, "vald_finns": vald in modeller}


def lokal_ocr_tillganglig() -> bool:
    """Sant om instansen har en lokal modell inställd (adress och modellnamn)."""
    return bool(_get_lokal_ocr_url() and _get_lokal_ocr_modell())


async def ocr_gravplats_lokal(png_images: list[bytes]) -> tuple[dict, dict]:
    """Skicka bilderna till en lokal vision-modell via ollama och returnera (json, usage).

    Samma specifikation och instruktion som Claude får. usage innehåller
    input_tokens, output_tokens och modell.
    """
    modell = _get_lokal_ocr_modell()
    if not modell:
        raise LokalOcrFel("Ingen lokal modell är vald. Be en administratör välja en under Inställningar.")
    payload = {
        "model": modell,
        "stream": False,
        "think": False,
        "format": "json",
        # Tokensannolikheter ger modellens säkerhet per sifferfält (app/utils/sakerhet.py)
        "logprobs": True,
        "top_logprobs": 3,
        # Taket hindrar en modell som fastnat i en slinga från att låsa GPU:n i minuter.
        # Ett fullt kort med tio gravsatta ger cirka 2 500 tokens.
        "options": {"temperature": 0, "num_predict": 6000},
        "messages": [
            {"role": "system", "content": _load_spec()},
            {
                "role": "user",
                "content": OCR_INSTRUKTION,
                "images": [base64.standard_b64encode(b).decode("utf-8") for b in png_images],
            },
        ],
    }
    async with httpx.AsyncClient(timeout=600) as client:
        bas = await _lokal_bas_url(client, ta_ansprak=True)
        try:
            resp = await client.post(f"{bas}/api/chat", json=payload)
        except httpx.TimeoutException as exc:
            raise LokalOcrFel("Den lokala modellen svarade inte i tid.") from exc
        except httpx.HTTPError as exc:
            raise LokalOcrFel("Den lokala modellservern går inte att nå. Är datorn påslagen?") from exc
    if resp.status_code == 404:
        raise LokalOcrFel(f"Modellen {modell} finns inte på den lokala servern.")
    if not resp.is_success:
        raise LokalOcrFel(f"Den lokala modellen gav fel (HTTP {resp.status_code}).")
    raw = resp.json()
    try:
        result = json.loads(_rensa_json(raw.get("message", {}).get("content", "")))
    except json.JSONDecodeError as exc:
        raise LokalOcrFel("Den lokala modellen gav inget giltigt svar. Försök igen.") from exc
    if not isinstance(result, dict):
        raise LokalOcrFel("Den lokala modellen gav inget giltigt svar. Försök igen.")
    usage = {
        "input_tokens": raw.get("prompt_eval_count", 0) or 0,
        "output_tokens": raw.get("eval_count", 0) or 0,
        "modell": modell,
        "osakra": osakra_falt(raw.get("message", {}).get("content", ""), raw.get("logprobs") or []),
        # Siffror för portalens modelljobb (token per sekund, avklippt svar)
        "svar_meta": {k: raw.get(k) for k in ("eval_count", "eval_duration", "total_duration", "done_reason") if k in raw},
    }
    return result, usage


# ── Anthropic Batch API ───────────────────────────────────────────────────────

def _batch_headers(api_key: str) -> dict:
    return {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "message-batches-2024-09-24",
        "content-type": "application/json",
    }


def bygg_batch_request(custom_id: str, png_images: list[bytes]) -> dict:
    """Bygg ett request-objekt för Anthropics Batch API (en grav)."""
    spec = _load_spec()
    content: list[dict] = []
    for img_bytes in png_images:
        data = base64.standard_b64encode(img_bytes).decode("utf-8")
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": "image/png", "data": data},
        })
    content.append({"type": "text", "text": OCR_INSTRUKTION})
    return {
        "custom_id": custom_id,
        "params": {
            "model": _get_claude_model(),
            "max_tokens": 8192,
            "system": [{"type": "text", "text": spec, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": content}],
        },
    }


async def skicka_anthropic_batch(requests: list[dict], api_key: str) -> str:
    """Skicka en lista requests till Anthropics Batch API. Returnerar batch_id."""
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(
            ANTHROPIC_BATCH_URL,
            json={"requests": requests},
            headers=_batch_headers(api_key),
        )
        if not resp.is_success:
            raise ValueError(f"Batch API HTTP {resp.status_code}: {resp.text}")
    return resp.json()["id"]


async def poll_anthropic_batch(batch_id: str, api_key: str) -> dict:
    """Hämta status för en Anthropic-batch. Returnerar {processing_status, request_counts}."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            f"{ANTHROPIC_BATCH_URL}/{batch_id}",
            headers=_batch_headers(api_key),
        )
        if not resp.is_success:
            raise ValueError(f"Batch poll HTTP {resp.status_code}: {resp.text}")
    raw = resp.json()
    return {
        "processing_status": raw.get("processing_status"),
        "request_counts": raw.get("request_counts", {}),
    }


async def hamta_anthropic_batch_resultat(batch_id: str, api_key: str) -> list[dict]:
    """Hämta och parsa JSONL-resultat för en avslutad Anthropic-batch."""
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.get(
            f"{ANTHROPIC_BATCH_URL}/{batch_id}/results",
            headers=_batch_headers(api_key),
        )
        if not resp.is_success:
            raise ValueError(f"Batch results HTTP {resp.status_code}: {resp.text}")
    return [json.loads(line) for line in resp.text.strip().splitlines() if line.strip()]
