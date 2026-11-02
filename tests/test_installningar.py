"""Instansinställningarna under /api/settings/api-keys."""
from app.services.ocr_service import lokal_ocr_tillganglig
from app.utils import api_keys


def test_lokal_modell_och_claude_modell_sparas_och_galler_direkt(logga_in, monkeypatch, tmp_path):
    monkeypatch.setattr(api_keys, "API_KEYS_PATH", tmp_path / "api_keys.json")
    from app.routes import system
    monkeypatch.setattr(system, "API_KEYS_PATH", tmp_path / "api_keys.json")
    api_keys._invalidate_cache()
    c = logga_in("inst-admin", is_admin=True)
    assert lokal_ocr_tillganglig() is False

    r = c.put("/api/settings/api-keys", json={"lokal_ocr_url": " http://portal/api/ollama/active ",
                                               "lokal_ocr_modell": "gemma4:12b", "claude_model": "claude-x"})
    assert r.status_code == 200
    d = c.get("/api/settings/api-keys").json()
    assert (d["lokal_ocr_url"], d["lokal_ocr_modell"], d["claude_model"]) == (
        "http://portal/api/ollama/active", "gemma4:12b", "claude-x")
    assert lokal_ocr_tillganglig() is True  # utan omstart: cachen nollställs vid sparning

    # Andra fält rör inte de sparade värdena, tom sträng tar bort
    c.put("/api/settings/api-keys", json={"claude_aktiv_instans": False})
    assert c.get("/api/settings/api-keys").json()["lokal_ocr_modell"] == "gemma4:12b"
    c.put("/api/settings/api-keys", json={"lokal_ocr_modell": ""})
    assert c.get("/api/settings/api-keys").json()["lokal_ocr_modell"] == ""
    api_keys._invalidate_cache()
