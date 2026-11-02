"""Rimlighetskontroll av OCR-svar: datum som inte kan stämma.

Reglerna fångar läsfel som ger omöjliga värden, till exempel en dödsmånad
som lästs som 05 fast kortet säger 03, så att gravsättningen hamnar före
döden. Ett felläst värde som ändå ser rimligt ut fångas inte.

Varje varning pekar ut gravsatt (1-baserat, som i formuläret) och fält, så
gränssnittet kan visa den vid rätt rad.
"""
import datetime

MAX_ALDER = 110


def _heltal(v) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _datum(ar, manad, dag) -> datetime.date | None:
    """Datum om alla tre delarna finns och bildar ett giltigt datum, annars None."""
    a, m, d = _heltal(ar), _heltal(manad), _heltal(dag)
    if a is None or m is None or d is None:
        return None
    try:
        return datetime.date(a, m, d)
    except ValueError:
        return None


def _fullt_datum(text) -> datetime.date | None:
    """Tolka 'YYYY-MM-DD'. Ofullständiga datum ('YYYY', 'YYYY-MM') ger None."""
    delar = str(text or "").split("-")
    if len(delar) != 3:
        return None
    return _datum(*delar)


def _iso(d: datetime.date) -> str:
    return d.isoformat()


def kontrollera(svar: dict) -> list[dict]:
    """Lista med varningar: {"gravsatt": n, "falt": "...", "meddelande": "..."}."""
    varningar: list[dict] = []
    for i, g in enumerate(svar.get("gravsatta") or [], start=1):
        if not isinstance(g, dict):
            continue

        def varna(falt: str, meddelande: str) -> None:
            varningar.append({"gravsatt": i, "falt": falt, "meddelande": f"Gravsatt {i}: {meddelande}"})

        for falt, namn, hogst in (
            ("fodelse_manad", "födelsemånad", 12),
            ("dods_manad", "dödsmånad", 12),
            ("fodelse_dag", "födelsedag", 31),
            ("dods_dag", "dödsdag", 31),
        ):
            v = _heltal(g.get(falt))
            if v is not None and not 1 <= v <= hogst:
                varna(falt, f"{namn} {v} finns inte.")

        fod = _datum(g.get("fodelse_ar"), g.get("fodelse_manad"), g.get("fodelse_dag"))
        dod = _datum(g.get("dods_ar"), g.get("dods_manad"), g.get("dods_dag"))
        gravsatt = _fullt_datum(g.get("gravsatt_den"))
        fod_ar, dod_ar = _heltal(g.get("fodelse_ar")), _heltal(g.get("dods_ar"))

        if fod and dod and dod < fod:
            varna("dods_ar", f"dödsdatum {_iso(dod)} ligger före födelsedatum {_iso(fod)}.")
        elif fod_ar and dod_ar and dod_ar < fod_ar:
            varna("dods_ar", f"dödsår {dod_ar} ligger före födelseår {fod_ar}.")
        if fod_ar and dod_ar and dod_ar - fod_ar > MAX_ALDER:
            varna("fodelse_ar", f"blev {dod_ar - fod_ar} år enligt födelse- och dödsår. Kontrollera årtalen.")
        if dod and gravsatt and gravsatt < dod:
            varna("dods_manad", f"dödsdatum {_iso(dod)} ligger efter gravsättningen {_iso(gravsatt)}. Kontrollera månad och dag.")
    return varningar
