"""Statusen "AI-läst, ej granskad": statistik, sökning, nästa-knappen och gravvyn."""
import json

import pytest

from app.database import (
    ClaudeOcrSvar, Gravplats, GravplatsInmatning, Gravsatt, LokalOcrSvar, MappConfig, User,
)

ORIMLIGT = {"gravsatta": [{"fodelse_ar": 1883, "fodelse_manad": 6, "fodelse_dag": 1, "dods_ar": 1937,
                           "dods_manad": 5, "dods_dag": 18, "gravsatt_den": "1937-03-23"}]}


@pytest.fixture
def kvarter(db, logga_in):
    """Ett eget kvarter med fem gravar i olika lägen. Returnerar (kvarter, {läge: gravplats_id})."""
    logga_in("status-user")
    uid = db.query(User.id).filter(User.username == "status-user").scalar()
    m = db.query(MappConfig).filter(MappConfig.namn == "statusmapp").first()
    if m is None:
        m = MappConfig(namn="statusmapp", kyrkogard="STK")
        db.add(m)
        db.flush()
    kv = f"S{db.query(Gravplats).count()}"
    bas = (db.query(Gravplats.start_sida).filter(Gravplats.mapp_id == m.id).order_by(Gravplats.start_sida.desc()).limit(1).scalar() or 0) + 3
    ids = {}
    for i, lage in enumerate(["ej", "ai", "ai_varning", "paborjad", "fardig"]):
        g = Gravplats(mapp_id=m.id, kvarter=kv, gravplatsnummer=str(i + 1), start_sida=bas + 3 * i, kyrkogard="STK")
        db.add(g)
        db.flush()
        ids[lage] = g.id
    db.add(LokalOcrSvar(gravplats_id=ids["ai"], modell="m", user_id=uid, skapad_den="x", svar_json="{}"))
    db.add(ClaudeOcrSvar(gravplats_id=ids["ai_varning"], user_id=uid, skapad_den="x", svar_json=json.dumps(ORIMLIGT)))
    # Påbörjad och färdig har också AI-svar, men människans arbete går före
    db.add(LokalOcrSvar(gravplats_id=ids["paborjad"], modell="m", user_id=uid, skapad_den="x", svar_json="{}"))
    db.add(Gravsatt(gravplats_id=ids["paborjad"], position=1, fornamn="Anna"))
    db.add(LokalOcrSvar(gravplats_id=ids["fardig"], modell="m", user_id=uid, skapad_den="x", svar_json="{}"))
    db.add(GravplatsInmatning(gravplats_id=ids["fardig"], fardigtranskriberad=True))
    db.commit()
    return kv, ids


def test_statistiken_raknar_ai_lasta_per_kvarter(kvarter, client):
    kv, _ = kvarter
    d = client.get("/api/statistik").json()["transkriberingsstatus"]
    stk = next(k for k in d["kyrkogardar"] if k["kyrkogard"] == "STK")
    rad = next(k for k in stk["kvarter"] if k["kvarter"] == kv)
    assert (rad["total"], rad["fardiga"], rad["ai"], rad["ai_varningar"]) == (5, 1, 2, 1)
    assert rad["gravplatser_status"] == ["e", "a", "a", "e", "f"]


@pytest.mark.parametrize("filter_,lagen", [
    ("ai", {"ai", "ai_varning"}),
    ("ai_varning", {"ai_varning"}),
    ("ej", {"ej"}),
    ("paborjad", {"paborjad"}),
    ("fardig", {"fardig"}),
])
def test_sokfiltret_skiljer_de_fyra_lagena(kvarter, client, filter_, lagen):
    kv, ids = kvarter
    r = client.get("/api/gravplatser/avancerad-sok", params={"kyrkogard": "STK", "kvarter": kv, "transkriberingsstatus": filter_})
    assert r.status_code == 200, r.text
    traffar = {g["id"] for g in r.json()["gravplatser"]}
    assert traffar == {ids[lage] for lage in lagen}


def test_nasta_ger_ai_last_grav_forst(kvarter, client):
    kv, _ = kvarter
    r = client.get("/api/gravplatser/nasta-ej-fardig", params={"kyrkogard": "STK", "kvarter": kv})
    assert r.json()["fullstandigt"] == f"STK {kv} 2"  # grav 1 är "ej", grav 2 är AI-läst


def test_inmatningen_berattar_om_ai_svar_och_varningar(kvarter, client):
    _, ids = kvarter
    assert client.get(f"/api/gravplats/{ids['ai_varning']}/inmatning").json()["ai_varningar"] == 1
    assert client.get(f"/api/gravplats/{ids['ai']}/inmatning").json()["ai_svar_finns"] is True
    assert client.get(f"/api/gravplats/{ids['ej']}/inmatning").json()["ai_svar_finns"] is False
