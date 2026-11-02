"""Gemensamma fixturer: appen mot en tom databas i en temporär DATA_DIR."""
import os
import tempfile

_TMP = tempfile.mkdtemp(prefix="gravreg-test-")
os.environ["DATA_DIR"] = _TMP
os.environ.pop("LOKAL_OCR_URL", None)
os.environ.pop("LOKAL_OCR_MODELL", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.database import SessionLocal, User  # noqa: E402
from app.main import app  # noqa: E402


async def _ingen_bakgrund():
    """Proven driver bakgrundskörningen steg för steg själva."""


@pytest.fixture(scope="session")
def client():
    from app.services import batch_korning
    batch_korning.korningsslinga = _ingen_bakgrund
    with TestClient(app) as c:
        yield c


@pytest.fixture
def db():
    with SessionLocal() as s:
        yield s


@pytest.fixture
def logga_in(client, db):
    """Skapa (eller uppdatera) en användare med givna flaggor och logga in den."""
    def _logga_in(namn: str, **flaggor) -> TestClient:
        u = db.query(User).filter(User.username == namn).first()
        if u is None:
            u = User(username=namn, password_hash=hash_password("hemligt"))
            db.add(u)
        for k, v in flaggor.items():
            setattr(u, k, v)
        db.commit()
        r = client.post("/api/login", json={"username": namn, "password": "hemligt"})
        assert r.status_code == 200, r.text
        return client
    return _logga_in
