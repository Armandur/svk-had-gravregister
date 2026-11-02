"""Rimlighetsreglerna för OCR-svar."""
from app.utils.rimlighet import kontrollera


def _gs(**f):
    bas = {"fodelse_ar": 1883, "fodelse_manad": 6, "fodelse_dag": 1, "dods_ar": 1937, "dods_manad": 3,
           "dods_dag": 18, "gravsatt_den": "1937-03-23"}
    bas.update(f)
    return {"gravsatta": [bas]}


def test_rimligt_kort_ger_inga_varningar():
    assert kontrollera(_gs()) == []


def test_hkg_u_2_dodsmanad_last_som_05():
    """Verkligt läsfel: gemma läste dödsmånad 05, kortet säger 03."""
    v = kontrollera(_gs(dods_manad=5))
    assert [(x["gravsatt"], x["falt"]) for x in v] == [(1, "dods_manad")]
    assert "1937-05-18" in v[0]["meddelande"] and "1937-03-23" in v[0]["meddelande"]


def test_dod_fore_fodsel_och_hog_alder():
    assert [x["falt"] for x in kontrollera(_gs(dods_ar=1873, gravsatt_den=""))] == ["dods_ar"]
    assert [x["falt"] for x in kontrollera(_gs(fodelse_ar=1783))] == ["fodelse_ar"]


def test_omojliga_manader_och_dagar():
    falt = [x["falt"] for x in kontrollera(_gs(fodelse_manad=13, dods_dag=32))]
    assert falt == ["fodelse_manad", "dods_dag"]


def test_ofullstandiga_datum_och_skrap_ger_inga_falska_larm():
    assert kontrollera(_gs(gravsatt_den="1937")) == []
    assert kontrollera(_gs(dods_dag=None, gravsatt_den="1937-03-01")) == []
    assert kontrollera({"gravsatta": [{"fodelse_ar": "okänt"}, "skräp"]}) == []
    assert kontrollera({}) == []
