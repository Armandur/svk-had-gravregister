"""Sökning i AI-lästa gravar som ingen har granskat än.

En AI-läst grav har ingen sparad transkribering, bara AI-svar. Sökningen
använder samma svar som gravvyn visar: Claudes om det finns, annars det
senaste lokala. Filtren tolkas som i den vanliga sökningen: textfält
matchar om de innehåller söktexten (utan hänsyn till versaler), årtal mot
ett intervall.
"""
import json
import re

from sqlalchemy.orm import Session

from app.database import ClaudeOcrSvar, LokalOcrSvar
from app.utils.gravplats_status import ai_lasta


def _ar(text) -> int | None:
    m = re.search(r"\b(1[6-9]\d{2}|20\d{2})\b", str(text or ""))
    return int(m.group(0)) if m else None


def ai_forslag(db: Session) -> dict[int, dict]:
    """{gravplats_id: {"svar": dict, "modell": str, "varningar": int}} för AI-lästa, ogranskade gravar."""
    varningar = ai_lasta(db)
    if not varningar:
        return {}
    ut: dict[int, dict] = {}
    for gid, svar_json, modell in (
        db.query(LokalOcrSvar.gravplats_id, LokalOcrSvar.svar_json, LokalOcrSvar.modell)
        .filter(LokalOcrSvar.gravplats_id.in_(varningar))
        .order_by(LokalOcrSvar.skapad_den)
    ):
        ut[gid] = {"svar_json": svar_json, "modell": modell}  # senaste lokala vinner
    for gid, svar_json, modell in db.query(ClaudeOcrSvar.gravplats_id, ClaudeOcrSvar.svar_json, ClaudeOcrSvar.modell).filter(
        ClaudeOcrSvar.gravplats_id.in_(varningar)
    ):
        ut[gid] = {"svar_json": svar_json, "modell": modell or "Claude"}  # Claude går före, som i gravvyn
    resultat: dict[int, dict] = {}
    for gid, d in ut.items():
        try:
            svar = json.loads(d["svar_json"])
        except (TypeError, ValueError):
            continue
        if isinstance(svar, dict):
            resultat[gid] = {"svar": svar, "modell": d["modell"], "varningar": varningar.get(gid, 0)}
    return resultat


def _innehaller(varde, sok: str | None) -> bool:
    return not sok or not sok.strip() or sok.strip().casefold() in str(varde or "").casefold()


def _inom(ar: int | None, fran: int | None, till: int | None) -> bool:
    if fran is None and till is None:
        return True
    if ar is None:
        return False
    return (fran is None or ar >= fran) and (till is None or ar <= till)


def _lista(svar: dict, nyckel: str) -> list[dict]:
    return [x for x in (svar.get(nyckel) or []) if isinstance(x, dict)]


def gravsatt_matchar(g: dict, f: dict) -> bool:
    """Gravsatt-raden uppfyller alla gravsatt-filter."""
    return (
        _innehaller(g.get("fornamn"), f.get("gravsatt_fornamn"))
        and _innehaller(g.get("efternamn"), f.get("gravsatt_efternamn"))
        and _inom(_ar(g.get("fodelse_ar")), f.get("gravsatt_fodda_fran"), f.get("gravsatt_fodda_till"))
        and _inom(_ar(g.get("dods_ar")), f.get("gravsatt_doda_fran"), f.get("gravsatt_doda_till"))
        and _inom(_ar(g.get("gravsatt_den")), f.get("gravsatt_gravsatta_fran"), f.get("gravsatt_gravsatta_till"))
    )


def grav_matchar(svar: dict, f: dict) -> bool:
    """Graven uppfyller alla innehållsfilter. Varje filter räcker med en rad, som i vanliga sökningen."""
    inn = _lista(svar, "innehavare")
    na = _lista(svar, "narmast_anhoriga")
    gs = _lista(svar, "gravsatta")

    def nagon(rader, falt, sok):
        return not sok or not sok.strip() or any(_innehaller(r.get(falt), sok) for r in rader)

    if not (nagon(inn, "fornamn", f.get("innehavare_fornamn")) and nagon(inn, "efternamn", f.get("innehavare_efternamn"))
            and nagon(inn, "yrke", f.get("innehavare_yrke"))):
        return False
    if not (nagon(na, "fornamn", f.get("anhorig_fornamn")) and nagon(na, "efternamn", f.get("anhorig_efternamn"))):
        return False
    if not (nagon(gs, "fornamn", f.get("gravsatt_fornamn")) and nagon(gs, "efternamn", f.get("gravsatt_efternamn"))):
        return False
    for nyckel, falt in (("gravsatt_fodda", "fodelse_ar"), ("gravsatt_doda", "dods_ar"), ("gravsatt_gravsatta", "gravsatt_den")):
        fran, till = f.get(nyckel + "_fran"), f.get(nyckel + "_till")
        if (fran is not None or till is not None) and not any(_inom(_ar(g.get(falt)), fran, till) for g in gs):
            return False
    return _inom(_ar(svar.get("utfardat_den")), f.get("utfardad_fran"), f.get("utfardad_till"))
