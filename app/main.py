"""FastAPI-app för gravregister – digitalisering av skannade gravregister (HKG/HKN)."""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware

from app.config import SESSION_SECRET_KEY
from app.database import SessionLocal, init_db
from app.auth import ensure_first_admin
from app.utils.git_version import _read_git_version

from app.routes import (
    auth,
    admin,
    datakvalitet,
    loggar,
    mappar,
    gravplatser,
    inmatning,
    ocr,
    batch,
    extramaterial,
    sidor,
    system,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _read_git_version()
    init_db()
    db = SessionLocal()
    try:
        ensure_first_admin(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="Gravregister – digitalisering",
    description="Applikation för att digitalisera skannade gravregister (HKG/HKN).",
    lifespan=lifespan,
)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET_KEY)


# Inkludera alla routers
app.include_router(system.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(datakvalitet.router)
app.include_router(loggar.router)
app.include_router(mappar.router)
app.include_router(gravplatser.router)
app.include_router(inmatning.router)
app.include_router(ocr.router)
app.include_router(batch.router)
app.include_router(extramaterial.router)
app.include_router(sidor.router)

# Statiska filer (CSS, JS m.m.)
static_dir = Path(__file__).resolve().parent.parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
