"""Routetabellen och säkerhetskopiornas routes."""
from collections import Counter

from app.main import app


def _alla_routes(routes):
    for r in routes:
        if hasattr(r, "original_router"):  # include_router packar in routern
            yield from _alla_routes(r.original_router.routes)
        else:
            yield r


def test_ingen_metod_och_sokvag_finns_tva_ganger():
    """Registrerar två filer samma route vinner den första tyst. Så tappade appen api-keys-ändringar."""
    antal = Counter((m, r.path) for r in _alla_routes(app.routes) for m in (getattr(r, "methods", None) or []))
    assert ("GET", "/api/backups") in antal, "provet ser inte de inkluderade routrarna"
    assert [k for k, v in antal.items() if v > 1] == []


def test_sakerhetskopia_skapas_listas_och_laddas_ner(logga_in):
    c = logga_in("backup-admin", is_admin=True)
    r = c.post("/api/backups")
    assert r.status_code == 200, r.text
    namn = r.json()["name"]
    assert namn.startswith("gravregister_") and namn.endswith(".db")

    assert namn in [b["name"] for b in c.get("/api/backups").json()["backups"]]
    r = c.get(f"/api/backups/{namn}")
    assert r.status_code == 200 and r.content.startswith(b"SQLite format 3")
    assert c.get("/api/backups/finns-inte.txt").status_code == 400


def test_sakerhetskopior_kraver_admin(logga_in):
    c = logga_in("backup-vanlig", is_admin=False)
    assert c.get("/api/backups").status_code == 403
    assert c.post("/api/backups").status_code == 403


# Routes som ska gå att nå utan inloggning. Allt annat under /api kräver den.
OPPNA = {
    ("GET", "/api/version"),
    ("POST", "/api/login"),
    ("POST", "/api/logout"),
    ("GET", "/api/toast-formuleringar"),
    ("GET", "/api/hjalp"),
    ("GET", "/api/hjalp/{slug}"),
}


def test_alla_api_routes_utom_de_oppna_kraver_inloggning(client):
    """Anropar varje route utloggad. Persondata får inte gå att nå utan konto.

    client-fixturen behövs för att bakgrundsslingan ska vara avstängd. Själva
    anropen går via en egen klient utan sessionskaka.
    """
    import re

    from fastapi.testclient import TestClient

    oppna_utan_krav = []
    with TestClient(app) as utloggad:
        for r in _alla_routes(app.routes):
            if not getattr(r, "path", "").startswith("/api"):
                continue
            url = re.sub(r"\{[^}]*\}", "x", re.sub(r"\{[^}]*:int\}", "1", r.path))
            for m in sorted((r.methods or set()) - {"HEAD"}):
                if (m, r.path) not in OPPNA and utloggad.request(m, url, json={}).status_code not in (401, 403):
                    oppna_utan_krav.append((m, r.path))
    assert oppna_utan_krav == []
