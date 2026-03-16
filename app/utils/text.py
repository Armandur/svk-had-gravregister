"""Text- och stränghjälpfunktioner."""


def _format_fullstandigt(kyrkogard: str | None, kvarter: str, gravplatsnummer: str) -> str:
    """Bygg fullständigt gravplatsnummer t.ex. HKN Allm 1+2."""
    parts = [p for p in (kyrkogard, kvarter.strip(), gravplatsnummer.strip()) if p]
    return " ".join(parts) if parts else ""


def _sanitize_backup_filename_part(s: str | None) -> str:
    """Endast alfanumeriskt, bindestreck och understreck (för branch/commit i filnamn)."""
    import re
    if not s or not s.strip():
        return "unknown"
    return re.sub(r"[^a-zA-Z0-9_-]", "", s.strip())[:80] or "unknown"


def _ledande_tal(nr: str) -> int:
    """Extraherar det ledande heltalet ur ett gravplatsnummer, t.ex. '42 Ser XXII' → 42."""
    s = (nr or "").strip()
    n = 0
    for c in s:
        if c.isdigit():
            n = n * 10 + int(c)
        elif n > 0:
            break
    return n if n > 0 else -1
