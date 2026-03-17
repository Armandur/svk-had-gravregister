"""API-nyckelhantering: läs och skriv api_keys.json."""
import json
import os

from app.config import API_KEYS_PATH

_CLAUDE_PRIS_DEFAULT = {"input": 3.00, "output": 15.00, "cache_creation": 3.75, "cache_read": 0.30}
_CLAUDE_PRIS_ENV_MAP = {
    "input": "CLAUDE_PRIS_INPUT",
    "output": "CLAUDE_PRIS_OUTPUT",
    "cache_creation": "CLAUDE_PRIS_CACHE_CREATION",
    "cache_read": "CLAUDE_PRIS_CACHE_READ",
}


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


def _get_spara_redigeringslogg_snapshot() -> bool:
    """Om True: spara en JSON-snapshot av inmatningsdata vid varje sparande (default: True)."""
    try:
        data = json.loads(API_KEYS_PATH.read_text(encoding="utf-8"))
        return bool(data.get("spara_redigeringslogg_snapshot", True))
    except (OSError, json.JSONDecodeError):
        return True


def _get_claude_pris() -> dict:
    """Returnera Claude-tokenpriser (USD per miljon tokens).

    Prioritetsordning: miljövariabel > api_keys.json > inbyggd standard.
    """
    pris = dict(_CLAUDE_PRIS_DEFAULT)
    try:
        data = json.loads(API_KEYS_PATH.read_text(encoding="utf-8"))
        for key in pris:
            json_key = f"claude_pris_{key}"
            if json_key in data and isinstance(data[json_key], (int, float)):
                pris[key] = float(data[json_key])
    except (OSError, json.JSONDecodeError):
        pass
    for key, env_var in _CLAUDE_PRIS_ENV_MAP.items():
        val = os.environ.get(env_var)
        if val:
            try:
                pris[key] = float(val)
            except ValueError:
                pass
    return pris


def _get_claude_pris_from_env() -> dict:
    """Returnera dict med bool per prisfält: True om värdet styrs av en miljövariabel."""
    return {key: bool(os.environ.get(env_var)) for key, env_var in _CLAUDE_PRIS_ENV_MAP.items()}


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
