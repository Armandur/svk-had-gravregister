"""Prov för OCR mot lokal modell: behörighet, svar och loggning via routerna."""
import pytest

import json

from app.database import ClaudeAnropslogg, ClaudeBatchJobb, ClaudeOcrSvar, Gravplats, LokalOcrSvar, MappConfig, User
from app.routes import batch as batch_routes
from app.routes import ocr as ocr_routes
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
    monkeypatch.setattr(batch_routes, "ocr_gravplats_lokal", fejk_ocr)
    monkeypatch.setattr(ocr_routes, "_collect_png_images_for_gravplats", lambda gid, db: [b"png"])
    monkeypatch.setattr(batch_routes, "_collect_png_images_for_gravplats", lambda gid, db: [b"png"])


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


def test_batch_med_lokal_motor(logga_in, grav, lokal_installd, db):
    c = logga_in("med", lokal_ocr_aktiv=True, claude_batch_aktiv=False)
    r = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": db.get(Gravplats, grav).kvarter, "ej_transkriberade": False,
                                               "ej_claude_korda": True, "antal": 1})
    assert r.status_code == 200, r.text
    assert r.json()["jobb_typ"] == "lokal"
    jobb_id = r.json()["id"]
    assert any(j["id"] == jobb_id for j in c.get("/api/batch-claude/jobb").json()["jobb"])
    r = c.post(f"/api/batch-claude/jobb/{jobb_id}/nasta?antal=5")
    assert r.status_code == 200, r.text
    assert r.json()["klara"] == 1
    db.expire_all()
    assert db.get(ClaudeBatchJobb, jobb_id).klara == 1
    # Graven har nu ett lokalt svar från samma modell och hoppas över i nästa lokala jobb
    r = c.post("/api/batch-claude/jobb", json={"motor": "lokal", "kvarter": db.get(Gravplats, grav).kvarter,
                                               "ej_transkriberade": False, "ej_claude_korda": True})
    assert r.status_code == 404


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
