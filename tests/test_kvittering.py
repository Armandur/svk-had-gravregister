"""Kvitteringen av en rimlighetsvarning följer personen, inte raden."""
from app.database import Gravplats, MappConfig

CECILIA = {"fornamn": "Cecilia", "fodelse_ar": 1850, "dods_ar": 1910}
ANNA = {"fornamn": "Anna", "dods_ar": 1937, "dods_manad": 5, "dods_dag": 18, "gravsatt_den": "1937-03-23"}
BERTIL = {"fornamn": "Bertil", "dods_ar": 1941, "dods_manad": 9, "dods_dag": 2, "gravsatt_den": "1941-08-30"}


def _varningar(c, gid):
    """{förnamn: kvitterad} för varningarna, via raden varningen pekar på."""
    namn = [g["fornamn"] for g in c.get(f"/api/gravplats/{gid}/inmatning").json()["gravsatta"]]
    return {namn[v["gravsatt"] - 1]: v["kvitterad"] is not None
            for v in c.get(f"/api/gravplats/{gid}/rimlighet").json()["varningar"]}


def test_kvitteringen_foljer_personen_nar_en_rad_ovanfor_tas_bort(logga_in, db):
    c = logga_in("kvitt-user")
    m = MappConfig(namn="kvittmapp", kyrkogard="KVT")
    db.add(m)
    db.flush()
    g = Gravplats(mapp_id=m.id, kvarter="K", gravplatsnummer="1", start_sida=1, kyrkogard="KVT")
    db.add(g)
    db.commit()
    url = f"/api/gravplats/{g.id}/inmatning"

    assert c.put(url, json={"gravsatta": [CECILIA, ANNA, BERTIL]}).status_code == 200
    anna = next(v for v in c.get(f"/api/gravplats/{g.id}/rimlighet").json()["varningar"] if v["gravsatt"] == 2)
    assert c.post(f"/api/gravplats/{g.id}/rimlighet/{anna['nyckel']}/kvittera", json={}).status_code == 200
    assert _varningar(c, g.id) == {"Anna": True, "Bertil": False}

    # Granskaren tar bort Cecilia: Anna och Bertil flyttar upp en rad var
    assert c.put(url, json={"gravsatta": [ANNA, BERTIL]}).status_code == 200
    assert _varningar(c, g.id) == {"Anna": True, "Bertil": False}

    # Rättar granskaren Annas dödsdatum gäller kvitteringen inte längre
    assert c.put(url, json={"gravsatta": [{**ANNA, "dods_manad": 4}, BERTIL]}).status_code == 200
    assert _varningar(c, g.id) == {"Anna": False, "Bertil": False}
