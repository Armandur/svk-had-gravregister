"""Transkriberingsstatus per gravplats, gemensam för statistik, sökning och nästa-knappen.

Fyra lägen som inte överlappar:

- färdig:   markerad färdigtranskriberad
- påbörjad: har data som en människa sparat, men är inte färdig
- ai:       har ett AI-svar (Claude eller lokal modell) men ingen sparad data
- ej:       varken data eller AI-svar

Ett AI-svar sparas bara som förslag och räknas inte som data. När någon
sparar formuläret blir graven påbörjad.
"""
import json

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import (
    ClaudeOcrSvar,
    GravplatsInmatning,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    GravplatsSkiss,
    Gravsatt,
    LokalOcrSvar,
)
from app.utils.kvittering import aktiva, kvitterade_per_grav
from app.utils.rimlighet import kontrollera

FARDIG, PABORJAD, AI, EJ = "fardig", "paborjad", "ai", "ej"


def ids_fardiga(db: Session) -> set[int]:
    return {gid for (gid,) in db.query(GravplatsInmatning.gravplats_id).filter(GravplatsInmatning.fardigtranskriberad == True)}  # noqa: E712


def ids_med_data(db: Session) -> set[int]:
    """Gravar där någon sparat minst ett ifyllt fält."""
    ids: set[int] = set()
    for tabell in (GravplatsInnehavare, GravplatsNarmastAnhorig, Gravsatt, GravplatsSkiss):
        ids.update(gid for (gid,) in db.query(tabell.gravplats_id).distinct())
    i = GravplatsInmatning
    ids.update(gid for (gid,) in db.query(i.gravplats_id).filter(or_(
        i.storlek != "", i.underhall_text != "", i.gravrattstid != "", i.monument != "",
        i.gravens_utformning != "", i.gravplats_nr != "", i.karta_nr != "", i.gravbrev_nr != "",
        i.utfordat_den != "", i.kommentar != "", i.skiss_bild.isnot(None),
    )))
    return ids


def ai_svar_per_grav(db: Session, ids: set[int] | None = None) -> dict[int, list[dict]]:
    """Alla sparade AI-svar per grav (Claude och lokala modeller), som tolkad JSON."""
    ut: dict[int, list[dict]] = {}
    for tabell in (ClaudeOcrSvar, LokalOcrSvar):
        q = db.query(tabell.gravplats_id, tabell.svar_json)
        if ids is not None:
            q = q.filter(tabell.gravplats_id.in_(ids))
        for gid, svar_json in q:
            try:
                ut.setdefault(gid, []).append(json.loads(svar_json))
            except (TypeError, ValueError):
                continue
    return ut


def osakra_per_grav(db: Session, ids: set[int] | None = None) -> dict[int, int]:
    """Antal osäkra sifferfält per grav, från det lokala svar som har flest."""
    ut: dict[int, int] = {}
    q = db.query(LokalOcrSvar.gravplats_id, LokalOcrSvar.osakra_falt).filter(LokalOcrSvar.osakra_falt.isnot(None))
    if ids is not None:
        q = q.filter(LokalOcrSvar.gravplats_id.in_(ids))
    for gid, osakra in q:
        try:
            n = len(json.loads(osakra))
        except (TypeError, ValueError):
            continue
        ut[gid] = max(ut.get(gid, 0), n)
    return ut


def ai_lasta(db: Session) -> dict[int, int]:
    """AI-lästa gravar som ingen har granskat än: {gravplats_id: antal varningar}.

    Varningar är orimliga datum plus siffror modellen var osäker på. Båda räknas
    på det svar som har flest, så graven flaggas om något svar har ett problem.
    """
    upptagna = ids_fardiga(db) | ids_med_data(db)
    osakra = osakra_per_grav(db)
    kvitt = kvitterade_per_grav(db)
    return {
        gid: max(len(aktiva(kontrollera(s), kvitt.get(gid))) for s in svar) + osakra.get(gid, 0)
        for gid, svar in ai_svar_per_grav(db).items()
        if gid not in upptagna and svar
    }


def status_per_grav(db: Session) -> tuple[dict[int, str], dict[int, int]]:
    """({gravplats_id: status}, {gravplats_id: varningar}) för alla gravar som inte är "ej".

    Gravar som saknas i första dicten har status "ej".
    """
    fardiga = ids_fardiga(db)
    status = {gid: PABORJAD for gid in ids_med_data(db)}
    ai = {gid: n for gid, n in ai_lasta(db).items()}
    for gid in ai:
        status[gid] = AI
    for gid in fardiga:
        status[gid] = FARDIG
    return status, ai
