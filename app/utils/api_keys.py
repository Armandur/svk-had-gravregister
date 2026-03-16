"""API-nyckelhantering: läs och skriv api_keys.json."""
import json
import os

from app.config import API_KEYS_PATH


def _get_anthropic_api_key() -> str | None:
    """Returnera Anthropic API-nyckel: miljövariabeln har prioritet, annars api_keys.json."""
    val = os.environ.get("ANTHROPIC_API_KEY")
    if val:
        return val
    try:
        data = json.loads(API_KEYS_PATH.read_text(encoding="utf-8"))
        return data.get("anthropic_api_key") or None
    except (OSError, json.JSONDecodeError):
        return None


def _get_claude_instans_aktiv() -> bool:
    """Returnera om Claude är aktiverat för hela instansen (api_keys.json)."""
    try:
        data = json.loads(API_KEYS_PATH.read_text(encoding="utf-8"))
        return bool(data.get("claude_aktiv_instans", True))
    except (OSError, json.JSONDecodeError):
        return True


def _get_claude_batch_block_enskild() -> bool:
    """Om True: blockera enskild Claude-körning för gravar i pågående batch-jobb (default: True)."""
    try:
        data = json.loads(API_KEYS_PATH.read_text(encoding="utf-8"))
        return bool(data.get("claude_batch_block_enskild", True))
    except (OSError, json.JSONDecodeError):
        return True


def _set_api_keys_json(**kwargs) -> None:
    """Uppdatera ett eller flera fält i api_keys.json."""
    existing: dict = {}
    if API_KEYS_PATH.is_file():
        try:
            existing = json.loads(API_KEYS_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            existing = {}
    existing.update(kwargs)
    API_KEYS_PATH.write_text(json.dumps(existing, ensure_ascii=False, indent=2), encoding="utf-8")
