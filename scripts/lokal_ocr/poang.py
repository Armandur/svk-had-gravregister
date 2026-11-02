"""Poängsätt OCR-svar (från kor.py) och Claudes sparade svar mot granskad transkribering.

Facit är det människor sparat för gravar markerade färdigtranskriberade.
Bara fält där facit eller svaret har ett värde räknas, så tomma par inte
blåser upp träffsäkerheten.

    DATA_DIR=/sökväg .venv/bin/python -m scripts.lokal_ocr.poang svar.jsonl
"""
import argparse
import difflib
import json
import re
from collections import defaultdict

from sqlalchemy import text

from app.database import SessionLocal

# gravplats_nr saknas avsiktligt: appen fyller aldrig kolumnen (0 av 806 granskade gravar).
SKALAR = {  # facit-kolumn -> svarsnyckel
    "storlek": "storlek", "underhall_text": "underhall_text", "gravrattstid": "gravrattstid",
    "monument": "monument", "gravens_utformning": "gravens_utformning",
    "karta_nr": "karta_nr", "gravbrev_nr": "gravbrev_nr",
    "utfordat_den": "utfardat_den",
}
INNEHAVARE = ["fornamn", "efternamn", "yrke", "gatuadress", "postnummer", "postort"]
GRAVSATT = ["fornamn", "efternamn", "fodelse_ar", "fodelse_manad", "fodelse_dag", "fod_nr",
            "dods_ar", "dods_manad", "dods_dag", "dodsbok_nr", "gravsatt_den", "urna"]
GRUPPER = {
    "namn": {"innehavare.fornamn", "innehavare.efternamn", "gravsatt.fornamn", "gravsatt.efternamn"},
    "datum": {f"gravsatt.{f}" for f in GRAVSATT if f.startswith(("fod", "dod", "gravsatt"))} | {"skalar.utfordat_den"},
}


def _norm(v) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).strip().casefold()


def _facit(db, gid: int) -> dict:
    rad = db.execute(text("select * from gravplats_inmatning where gravplats_id=:g"), {"g": gid}).mappings().first()
    inn = db.execute(text("select * from gravplats_innehavare where gravplats_id=:g order by sort_order, id"),
                     {"g": gid}).mappings().all()
    gs = db.execute(text("select * from gravsatt where gravplats_id=:g order by position"), {"g": gid}).mappings().all()
    return {"skalar": dict(rad), "innehavare": [dict(r) for r in inn], "gravsatta": [dict(r) for r in gs]}


def _par(facit: dict, svar: dict):
    """Ger (fält, facitvärde, svarsvärde) för alla jämförda fält."""
    svar = svar if isinstance(svar, dict) else {}
    for kol, nyckel in SKALAR.items():
        yield f"skalar.{kol}", facit["skalar"].get(kol), svar.get(nyckel)
    s_inn = svar.get("innehavare") or []
    for i, f in enumerate(facit["innehavare"]):
        s = s_inn[i] if i < len(s_inn) and isinstance(s_inn[i], dict) else {}
        for k in INNEHAVARE:
            yield f"innehavare.{k}", f.get(k), s.get(k)
    s_gs = svar.get("gravsatta") or []
    n = max(len(facit["gravsatta"]), len(s_gs))
    for i in range(n):
        f = facit["gravsatta"][i] if i < len(facit["gravsatta"]) else {}
        s = s_gs[i] if i < len(s_gs) and isinstance(s_gs[i], dict) else {}
        for k in GRAVSATT:
            yield f"gravsatt.{k}", f.get(k), s.get(k)


class Summa:
    def __init__(self):
        self.falt = defaultdict(lambda: [0, 0, 0.0])  # träffar, antal, likhetssumma
        self.antal_ratt = [0, 0]  # rätt antal gravsatta
        self.sek = []
        self.trasig_json = 0

    def lagg_till(self, facit: dict, svar: dict | None) -> None:
        if svar is None:
            self.trasig_json += 1
        n_svar = len((svar or {}).get("gravsatta") or [])
        self.antal_ratt[0] += n_svar == len(facit["gravsatta"])
        self.antal_ratt[1] += 1
        for falt, f, s in _par(facit, svar or {}):
            fn, sn = _norm(f), _norm(s)
            if not fn and not sn:
                continue
            t = self.falt[falt]
            t[0] += fn == sn
            t[1] += 1
            t[2] += difflib.SequenceMatcher(None, fn, sn).ratio()

    def _agg(self, nycklar) -> tuple[float, float, int]:
        tr = sum(self.falt[k][0] for k in nycklar)
        an = sum(self.falt[k][1] for k in nycklar)
        li = sum(self.falt[k][2] for k in nycklar)
        return (tr / an if an else 0.0, li / an if an else 0.0, an)

    def rapport(self) -> dict:
        alla = list(self.falt)
        ut = {"totalt": self._agg(alla)}
        for namn, nycklar in GRUPPER.items():
            ut[namn] = self._agg([k for k in alla if k in nycklar])
        ut["antal_gravsatta_ratt"] = self.antal_ratt[0] / max(self.antal_ratt[1], 1)
        ut["trasig_json"] = self.trasig_json
        ut["median_sek"] = sorted(self.sek)[len(self.sek) // 2] if self.sek else None
        ut["per_falt"] = {k: (v[0] / v[1], v[1]) for k, v in sorted(self.falt.items())}
        return ut


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("svar", nargs="+")
    ap.add_argument("--per-falt", action="store_true")
    a = ap.parse_args()

    rader = [json.loads(r) for fil in a.svar for r in open(fil) if r.strip()]
    db = SessionLocal()
    per_modell: dict[tuple, Summa] = defaultdict(Summa)
    gravar = set()
    for r in rader:
        nyckel = (r["modell"], r.get("max_sida", 0))
        facit = _facit(db, r["gravplats_id"])
        per_modell[nyckel].lagg_till(facit, r.get("json"))
        if r.get("sek"):
            per_modell[nyckel].sek.append(r["sek"])
        gravar.add(r["gravplats_id"])

    claude = Summa()
    for gid in sorted(gravar):
        sj = db.execute(text("select svar_json from claude_ocr_svar where gravplats_id=:g"), {"g": gid}).scalar()
        if sj:
            claude.lagg_till(_facit(db, gid), json.loads(sj))
    if claude.antal_ratt[1]:
        per_modell[("claude (sparat svar)", 0)] = claude

    print(f"{'modell':28} {'bild':>5} {'gravar':>6} {'exakt':>6} {'likhet':>6} {'namn':>6} {'datum':>6} "
          f"{'antal':>6} {'trasig':>6} {'sek':>5}")
    for (m, ms), s in sorted(per_modell.items(), key=lambda x: -x[1].rapport()["totalt"][0]):
        r = s.rapport()
        print(f"{m:28} {ms or 'orig':>5} {s.antal_ratt[1]:>6} {r['totalt'][0]:6.1%} {r['totalt'][1]:6.1%} "
              f"{r['namn'][0]:6.1%} {r['datum'][0]:6.1%} {r['antal_gravsatta_ratt']:6.1%} "
              f"{r['trasig_json']:>6} {r['median_sek'] or 0:5.0f}")
        if a.per_falt:
            for k, (andel, n) in r["per_falt"].items():
                print(f"    {k:28} {andel:6.1%} (n={n})")


if __name__ == "__main__":
    main()
