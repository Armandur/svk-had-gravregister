"""Skickar gravplatskortbilder till Claude och returnerar strukturerad JSON."""
import base64
import json
from pathlib import Path

import httpx

from app.utils.api_keys import _get_claude_model

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_BATCH_URL = "https://api.anthropic.com/v1/messages/batches"

_SPEC_PATH = Path(__file__).resolve().parent.parent / "prompts" / "gravregister_spec.md"


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
    content.append({
        "type": "text",
        "text": (
            "Extrahera all data från dessa gravplatskort enligt specifikationen "
            "och returnera ENBART giltig JSON, utan förklaringar eller markdown. "
            "Lägg till ett fält 'ocr_kommentar' (sträng) med en övergripande "
            "notering om eventuella märkligheter, osäkerheter eller avvikelser "
            "du stött på – lämna tom sträng om allt är tydligt. "
            "Kommentera bara på saker som kan påverka datakvaliteten eller kräver "
            "manuell kontroll – inte på tomma fält eller förtryckt text som saknar ifyllnad."
        ),
    })

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
    content.append({
        "type": "text",
        "text": (
            "Extrahera all data från dessa gravplatskort enligt specifikationen "
            "och returnera ENBART giltig JSON, utan förklaringar eller markdown. "
            "Lägg till ett fält 'ocr_kommentar' (sträng) med en övergripande "
            "notering om eventuella märkligheter, osäkerheter eller avvikelser "
            "du stött på – lämna tom sträng om allt är tydligt. "
            "Kommentera bara på saker som kan påverka datakvaliteten eller kräver "
            "manuell kontroll – inte på tomma fält eller förtryckt text som saknar ifyllnad."
        ),
    })
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
