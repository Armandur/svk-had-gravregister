"""Prov för OCR mot lokal modell: behörighet, svar och loggning via routerna."""
import pytest

import asyncio
import json

from app.database import ClaudeAnropslogg, ClaudeBatchJobb, ClaudeOcrSvar, Gravplats, LokalOcrSvar, MappConfig, User
from app.services import batch_korning
from app.routes import ocr as ocr_routes
from app.services.ocr_service import LokalOcrFel
from app.utils import api_keys

SVAR = {"innehavare": [], "gravsatta": [], "storlek": "4 kvm", "ocr_kommentar": ""}


@pytest.fixture
def grav(db):
    m = db.query(MappConfig).filter(MappConfig.namn == "provmapp").first()
    if m is None:
        m = MappConfig(namn="provmapp", kyrkogard="HKG")
        db.add(m)
        db.flush()
    sida = (db.query(Gravplats).count() + 1) * 3
    g = Gravplats(mapp_id=m.id, kvarter=f"k{sida}", gravplatsnummer="7", start_sida=sida, kyrkogard="HKG")
    db.add(g)
    db.commit()
    return g.id


@pytest.fixture
def lokal_installd(monkeypatch):
    monkeypatch.setattr(api_keys, "_load_api_keys",
                        lambda: {"lokal_ocr_url": "http://modellserver:11434", "lokal_ocr_modell": "provmodell"})

    async def fejk_ocr(bilder):
        assert bilder == [b"png"]
        return dict(SVAR), {"input_tokens": 9000, "output_tokens": 400, "modell": "provmodell"}

    monkeypatch.setattr(ocr_routes, "ocr_gravplats_lokal", fejk_ocr)
    monkeypatch.setattr(batch_korning, "ocr_gravplats_lokal", fejk_ocr)
    monkeypatch.setattr(ocr_routes, "_collect_png_images_for_gravplats", lambda gid, db: [b"png"])
    monkeypatch.setattr(batch_korning, "_bilder", lambda gid: [b"png"])


def test_utan_flagga_nekas(logga_in, grav, lokal_installd):
    c = logga_in("utan", lokal_ocr_aktiv=False)
    r = c.post(f"/api/ocr/lokal/gravplats/{grav}")
    assert r.status_code == 403
    assert "inte aktiverad" in r.json()["detail"]


def test_ej_installd_ger_503(logga_in, grav, monkeypatch):
    monkeypatch.setattr(api_keys, "_load_api_keys", lambda: {})
    c = logga_in("med", lokal_ocr_aktiv=True)
    r = c.post(f"/api/ocr/lokal/gravplats/{grav}")
    assert r.status_code == 503
    assert c.get("/api/me").json()["lokal_ocr_tillganglig"] is False


def test_enskild_grav_sparar_svar_och_logg(logga_in, grav, lokal_installd, db):
    c = logga_in("med", lokal_ocr_aktiv=True)
    uid = db.query(User.id).filter(User.username == "med").scalar()
    db.add(ClaudeOcrSvar(gravplats_id=grav, user_id=uid, skapad_den="2026-01-01T00:00:00+00:00",
                         svar_json=json.dumps({"storlek": "claude-varde"}), modell="claude-sonnet-4-6"))
    db.commit()
    assert c.get("/api/me").json()["lokal_ocr_tillganglig"] is True
    r = c.post(f"/api/ocr/lokal/gravplats/{grav}")
    assert r.status_code == 200, r.text
    assert r.json()["storlek"] == "4 kvm"
    assert r.json()["_ocr_usage"]["modell"] == "provmodell"
    db.expire_all()
    # Claudes svar ligger kvar orört, det lokala sparas bredvid
    assert json.loads(db.query(ClaudeOcrSvar).filter(ClaudeOcrSvar.gravplats_id == grav).one().svar_json)["storlek"] == "claude-varde"
    assert db.query(LokalOcrSvar).filter(LokalOcrSvar.gravplats_id == grav).one().modell == "provmodell"
    logg = db.query(ClaudeAnropslogg).filter(ClaudeAnropslogg.gravplats_id == grav).one()
    assert (logg.modell, logg.kostnad_usd, logg.input_tokens) == ("provmodell", 0.0, 9000)
    assert logg.svarstid_ms is not None
    alla = c.get(f"/api/ocr/gravplats/{grav}/svar-alla").json()["svar"]
    assert [(s["kalla"], s["svar_json"]["storlek"]) for s in alla] == [("claude", "claude-varde"), ("lokal", "4 kvm")]


def test_batch_med_lokal_motor_kors_i_bakgrunden(logga_in, grav, lokal_installd, db):
    c = logga_in("med", lokal_ocr_aktiv=True, claude_batch_aktiv=False)
    kvarter = db.get(Gravplats, grav).kvarter
    r = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": kvarter, "ej_transkriberade": False,
                                               "ej_claude_korda": True, "antal": 1})
    assert r.status_code == 200, r.text
    assert r.json()["jobb_typ"] == "lokal"
    jobb_id = r.json()["id"]
    assert c.get(f"/api/batch-claude/jobb/{jobb_id}").json()["status"] == "kör"
    # Webbläsarens slinga avvisas, servern kör själv
    assert c.post(f"/api/batch-claude/jobb/{jobb_id}/nasta").status_code == 409
    assert asyncio.run(batch_korning.kor_ett_steg()) is True
    assert asyncio.run(batch_korning.kor_ett_steg()) is False  # kön tom, jobbet markeras klart
    jobb = c.get(f"/api/batch-claude/jobb/{jobb_id}").json()
    assert (jobb["status"], jobb["klara"]) == ("klar", 1)
    assert db.query(LokalOcrSvar).filter(LokalOcrSvar.gravplats_id == grav).count() == 1
    # Graven har nu ett lokalt svar från samma modell och hoppas över i nästa lokala jobb
    r = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": kvarter,
                                               "ej_transkriberade": False, "ej_claude_korda": True})
    assert r.status_code == 404


def test_paus_och_starta(logga_in, grav, lokal_installd, db):
    c = logga_in("med", lokal_ocr_aktiv=True)
    jobb_id = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": db.get(Gravplats, grav).kvarter,
                                                     "ej_transkriberade": False}).json()["id"]
    assert c.post(f"/api/batch-claude/jobb/{jobb_id}/pausa").json()["status"] == "pausad"
    assert asyncio.run(batch_korning.kor_ett_steg()) is False  # pausat jobb rörs inte
    assert c.post(f"/api/batch-claude/jobb/{jobb_id}/starta").json()["status"] == "kör"
    assert asyncio.run(batch_korning.kor_ett_steg()) is True


def test_upptagen_server_lagger_tillbaka_graven(logga_in, grav, lokal_installd, db, monkeypatch):
    async def upptagen(bilder):
        raise LokalOcrFel("Modellservern är upptagen av en annan körning.")
    monkeypatch.setattr(batch_korning, "ocr_gravplats_lokal", upptagen)
    c = logga_in("med", lokal_ocr_aktiv=True)
    jobb_id = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": db.get(Gravplats, grav).kvarter,
                                                     "ej_transkriberade": False}).json()["id"]
    with pytest.raises(batch_korning.ServernOtillganglig):
        asyncio.run(batch_korning.kor_ett_steg())
    jobb = c.get(f"/api/batch-claude/jobb/{jobb_id}").json()
    assert (jobb["status"], jobb["fel"], jobb["poster"][0]["status"]) == ("kör", 0, "väntar")
    assert "upptagen" in jobb["lagesbesked"]
    c.post(f"/api/batch-claude/jobb/{jobb_id}/avbryt")


def test_omstart_aterstaller_fastnade_gravar(logga_in, grav, db):
    from app.database import ClaudeBatchJobbPost
    logga_in("med")
    uid = db.query(User.id).filter(User.username == "med").scalar()
    jobb = {}
    for typ in ("realtid", "lokal"):
        j = ClaudeBatchJobb(user_id=uid, namn=typ, skapad_den="x", status="kör", totalt=1, klara=0, fel=0, jobb_typ=typ)
        db.add(j)
        db.flush()
        db.add(ClaudeBatchJobbPost(jobb_id=j.id, gravplats_id=grav, ordning=0, status="kör"))
        jobb[typ] = j.id
    db.commit()
    batch_korning.aterstall_efter_omstart()
    db.expire_all()
    assert db.get(ClaudeBatchJobb, jobb["realtid"]).status == "pausad"  # ingen flik driver det längre
    assert db.get(ClaudeBatchJobb, jobb["lokal"]).status == "kör"       # fortsätter i bakgrunden
    for j in jobb.values():
        assert db.query(ClaudeBatchJobbPost).filter(ClaudeBatchJobbPost.jobb_id == j).one().status == "väntar"
        db.get(ClaudeBatchJobb, j).status = "avbruten"
    db.commit()


def test_claude_batch_kraver_fortfarande_claudeflagga(logga_in, grav, lokal_installd):
    c = logga_in("med", lokal_ocr_aktiv=True, claude_batch_aktiv=False)
    r = c.post("/api/batch-claude/jobb", json={"motor": "claude", "kvarter": "x", "ej_transkriberade": False})
    assert r.status_code == 403


def test_admin_kan_sla_pa_flaggan(logga_in, db):
    logga_in("annan")
    c = logga_in("adm", is_admin=True)
    uid = db.query(User.id).filter(User.username == "annan").scalar()
    r = c.put(f"/api/admin/users/{uid}/lokal-ocr-aktiv", json={"aktiv": True})
    assert r.status_code == 200 and r.json()["lokal_ocr_aktiv"] is True
    lista = c.get("/api/admin/users").json()["users"]
    assert next(u for u in lista if u["id"] == uid)["lokal_ocr_aktiv"] is True


def test_lokal_route_sparras_for_grav_i_pagaende_batch(logga_in, grav, lokal_installd, db):
    from app.database import ClaudeBatchJobbPost
    c = logga_in("med", lokal_ocr_aktiv=True)
    uid = db.query(User.id).filter(User.username == "med").scalar()
    jobb = ClaudeBatchJobb(user_id=uid, namn="pågår", skapad_den="2026-11-02", status="kör", totalt=1,
                           klara=0, fel=0, filter_json="{}", jobb_typ="realtid")
    db.add(jobb)
    db.flush()
    db.add(ClaudeBatchJobbPost(jobb_id=jobb.id, gravplats_id=grav, ordning=0, status="väntar"))
    db.commit()
    r = c.post(f"/api/ocr/lokal/gravplats/{grav}")
    assert r.status_code == 409
    assert "pågår" in r.json()["detail"]


@pytest.mark.parametrize("status,ska_falla", [(200, False), (409, True)])
def test_ansprak_i_vaxeln(monkeypatch, status, ska_falla):
    """Via växeln tas ett anspråk. Har någon annan servern avbryts körningen med ett begripligt besked."""
    import asyncio
    import httpx
    from app.services import ocr_service

    def svar(request):
        if request.url.path == "/api/ollama/active":
            return httpx.Response(200, json={"name": "dator", "url": "http://dator:11434"})
        if request.url.path == "/api/ollama/endpoints/dator/claim":
            return httpx.Response(status, json={"detail": "annan har anspråk"} if status == 409 else {})
        return httpx.Response(404)

    monkeypatch.setattr(api_keys, "_load_api_keys", lambda: {"lokal_ocr_url": "http://portal/api/ollama/active"})

    async def kor():
        async with httpx.AsyncClient(transport=httpx.MockTransport(svar)) as k:
            return await ocr_service._lokal_bas_url(k, ta_ansprak=True)

    if ska_falla:
        with pytest.raises(ocr_service.LokalOcrFel, match="upptagen"):
            asyncio.run(kor())
    else:
        assert asyncio.run(kor()) == "http://dator:11434"


def test_svarslistan_och_lokal_route_bar_rimlighetsvarningar(logga_in, grav, lokal_installd, db, monkeypatch):
    fel_svar = {"gravsatta": [{"fodelse_ar": 1883, "fodelse_manad": 6, "fodelse_dag": 1, "dods_ar": 1937,
                               "dods_manad": 5, "dods_dag": 18, "gravsatt_den": "1937-03-23"}]}

    async def felläst(bilder):
        return dict(fel_svar), {"input_tokens": 1, "output_tokens": 1, "modell": "provmodell"}

    monkeypatch.setattr(ocr_routes, "ocr_gravplats_lokal", felläst)
    c = logga_in("med", lokal_ocr_aktiv=True)
    r = c.post(f"/api/ocr/lokal/gravplats/{grav}")
    assert [v["falt"] for v in r.json()["_varningar"]] == ["dods_manad"]
    sparat = c.get(f"/api/ocr/gravplats/{grav}/svar-alla").json()["svar"]
    assert [v["falt"] for v in sparat[0]["varningar"]] == ["dods_manad"]
    assert "_varningar" not in sparat[0]["svar_json"]


def test_osakra_siffror_sparas_och_raknas_som_varningar(logga_in, grav, lokal_installd, db, monkeypatch):
    async def osaker(bilder):
        return {"gravsatta": [{"dods_ar": 1972}]}, {"input_tokens": 1, "output_tokens": 1, "modell": "provmodell",
                                                    "osakra": {"gravsatta.0.dods_ar": {"sakerhet": 0.64, "kanske": "1975"}}}

    monkeypatch.setattr(ocr_routes, "ocr_gravplats_lokal", osaker)
    c = logga_in("med", lokal_ocr_aktiv=True)
    r = c.post(f"/api/ocr/lokal/gravplats/{grav}")
    assert r.json()["_osakra"]["gravsatta.0.dods_ar"]["kanske"] == "1975"
    sparat = c.get(f"/api/ocr/gravplats/{grav}/svar-alla").json()["svar"]
    assert sparat[-1]["osakra"] == {"gravsatta.0.dods_ar": {"sakerhet": 0.64, "kanske": "1975"}}
    assert c.get(f"/api/gravplats/{grav}/inmatning").json()["ai_varningar"] == 1


def test_takt_raknar_median_och_hoppar_over_pauser(logga_in, db, lokal_installd):
    from datetime import datetime, timedelta, timezone
    from app.database import ClaudeBatchJobbPost
    logga_in("taktare", lokal_ocr_aktiv=True)
    uid = db.query(User.id).filter(User.username == "taktare").scalar()
    m = db.query(MappConfig).filter(MappConfig.namn == "provmapp").first() or MappConfig(namn="provmapp", kyrkogard="HKG")
    db.add(m)
    db.flush()
    start = datetime(2026, 11, 2, 20, 0, tzinfo=timezone.utc)
    jobb = ClaudeBatchJobb(user_id=uid, namn="takt", skapad_den=start.isoformat(), status="kör", totalt=8,
                           klara=5, fel=0, jobb_typ="lokal")
    db.add(jobb)
    db.flush()
    bas = (db.query(Gravplats.start_sida).order_by(Gravplats.start_sida.desc()).limit(1).scalar() or 0) + 3
    # Fem klara gravar: 10 s mellan de fyra första, sedan en paus på 30 minuter. Tre väntar.
    tider = [start + timedelta(seconds=s) for s in (0, 10, 20, 30, 1830)]
    for i in range(8):
        g = Gravplats(mapp_id=m.id, kvarter="takt", gravplatsnummer=str(i), start_sida=bas + 3 * i, kyrkogard="HKG")
        db.add(g)
        db.flush()
        db.add(ClaudeBatchJobbPost(jobb_id=jobb.id, gravplats_id=g.id, ordning=i, status="klar" if i < 5 else "väntar"))
        if i < 5:
            db.add(ClaudeAnropslogg(user_id=uid, gravplats_id=g.id, anropad_den=tider[i].isoformat(), modell="m"))
    db.commit()
    t = batch_korning.takt(db, jobb)
    assert (t["sek_per_grav"], t["kvar"]) == (10.0, 3)
    c = logga_in("taktare")
    assert c.get(f"/api/batch-claude/jobb/{jobb.id}").json()["takt"]["sek_per_grav"] == 10.0
    jobb.status = "avbruten"
    db.commit()


def test_koade_jobb_kors_i_ordning_och_laser_inte_samma_grav_tva_ganger(logga_in, grav, lokal_installd, db, monkeypatch):
    anrop = []

    async def raknande(bilder):
        anrop.append(1)
        return dict(SVAR), {"input_tokens": 1, "output_tokens": 1, "modell": "provmodell"}

    monkeypatch.setattr(batch_korning, "ocr_gravplats_lokal", raknande)
    c = logga_in("med", lokal_ocr_aktiv=True)
    kv = db.get(Gravplats, grav).kvarter
    forsta = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": kv, "ej_transkriberade": False,
                                                    "ej_claude_korda": False, "namn": "första"}).json()["id"]
    andra = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": kv, "ej_transkriberade": False,
                                                   "ej_claude_korda": False, "namn": "andra"}).json()["id"]
    ko = c.get(f"/api/batch-claude/jobb/{andra}").json()["ko"]
    assert (ko["plats"], ko["aktivt_jobb"], ko["gravar_fore"]) == (2, "första", 1)
    assert c.get(f"/api/batch-claude/jobb/{forsta}").json()["ko"] is None

    assert asyncio.run(batch_korning.kor_ett_steg()) is True   # första jobbet läser graven
    assert asyncio.run(batch_korning.kor_ett_steg()) is True   # andra jobbet: redan läst, ingen ny läsning
    assert len(anrop) == 1
    assert c.get(f"/api/batch-claude/jobb/{andra}").json()["klara"] == 1
    asyncio.run(batch_korning.kor_ett_steg())  # båda jobben markeras klara
    assert {c.get(f"/api/batch-claude/jobb/{j}").json()["status"] for j in (forsta, andra)} == {"klar"}
