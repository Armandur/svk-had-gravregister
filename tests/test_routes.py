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
