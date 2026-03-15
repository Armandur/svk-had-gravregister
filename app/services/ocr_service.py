"""Skickar gravplatskortbilder till Claude och returnerar strukturerad JSON."""
import base64
import json
from pathlib import Path

import httpx

ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-6"

_SPEC_PATH = Path(__file__).resolve().parent.parent / "prompts" / "gravregister_spec.md"


def _load_spec() -> str:
    return _SPEC_PATH.read_text(encoding="utf-8")


async def ocr_gravplats_from_images(png_images: list[bytes], api_key: str) -> dict:
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
        "model": MODEL,
        "max_tokens": 4096,
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

    return json.loads(text)
