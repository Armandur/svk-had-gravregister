"""Modellens säkerhet per fält, ur tokensannolikheterna (logprobs) från ollama.

Ett fälts säkerhet är sannolikheten för den minst säkra token i värdet.
Utvärderingen 2026-11-02 visade att måttet fungerar för siffror och datum:
under 0,95 var vartannat flaggat värde fel, och mer än hälften av sifferfelen
fångades. För text var det för svagt för att visa, så bara sifferfält tas med.

Till varje osäkert fält tas modellens andrahandsval fram: värdet med den
osäkra token utbytt mot den näst troligaste. För ett dödsår läst som 1972 med
5 som andraval blir förslaget 1975.
"""
import json
import math

GRANS = 0.95
SIFFERFALT = ("_ar", "_manad", "_dag", "fod_nr", "dodsbok_nr", "gravsatt_den", "utfardat_den")


def _spann(text: str) -> dict[str, tuple[int, int]]:
    """Sökväg ("gravsatta.0.dods_ar") -> teckenintervall för varje skalärt värde i JSON-texten."""
    ut: dict[str, tuple[int, int]] = {}
    i = 0

    def blanka() -> None:
        nonlocal i
        while i < len(text) and text[i] in " \t\r\n":
            i += 1

    def strang_slut(start: int) -> int:
        j = start + 1
        while text[j] != '"':
            j += 2 if text[j] == "\\" else 1
        return j + 1

    def varde(vag: list) -> None:
        nonlocal i
        blanka()
        c = text[i]
        if c in "{[":
            stang = "}" if c == "{" else "]"
            i += 1
            blanka()
            n = 0
            while text[i] != stang:
                blanka()
                if c == "{":
                    slut = strang_slut(i)
                    nyckel = json.loads(text[i:slut])
                    i = slut
                    blanka()
                    i += 1  # kolon
                    varde(vag + [nyckel])
                else:
                    varde(vag + [n])
                    n += 1
                blanka()
                if text[i] == ",":
                    i += 1
                    blanka()
            i += 1
            return
        start = i
        if c == '"':
            i = strang_slut(i)
        else:
            while i < len(text) and text[i] not in ",}] \t\r\n":
                i += 1
        ut[".".join(map(str, vag))] = (start, i)

    varde([])
    return ut


def osakra_falt(text: str, logprobs: list[dict], grans: float = GRANS) -> dict[str, dict]:
    """{sökväg: {"sakerhet": 0.64, "kanske": "1975"}} för sifferfält under gränsen.

    Tom dict om tokens och text inte går att para ihop, så ett oväntat svar
    aldrig fäller OCR-körningen.
    """
    if not logprobs:
        return {}
    tokens = []
    pos = 0
    for t in logprobs:
        s = t.get("token", "")
        tokens.append((pos, pos + len(s), t))
        pos += len(s)
    if pos != len(text):
        return {}
    try:
        spann = _spann(text)
    except (IndexError, ValueError):
        return {}
    ut: dict[str, dict] = {}
    for vag, (a, b) in spann.items():
        if not vag.endswith(SIFFERFALT):
            continue
        inom = [(ta, tb, t) for ta, tb, t in tokens if ta < b and tb > a]
        if not inom:
            continue
        ta, tb, svagast = min(inom, key=lambda x: x[2].get("logprob", 0.0))
        sakerhet = math.exp(svagast.get("logprob", 0.0))
        if sakerhet >= grans:
            continue
        falt = {"sakerhet": round(sakerhet, 2)}
        alternativ = [x for x in svagast.get("top_logprobs") or [] if x.get("token") != svagast.get("token")]
        if alternativ:
            nytt = text[a:ta] + alternativ[0]["token"] + text[tb:b]
            falt["kanske"] = nytt.strip('"')
        ut[vag] = falt
    return ut
