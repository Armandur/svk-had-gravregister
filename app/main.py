"""FastAPI-app för gravregister-PoC."""
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import KÄLLDATA_DIR
from app.database import SessionLocal, MappConfig, Extramaterial, init_db, get_db

# Cache-huvud för genererade bilder (1 timme; webbläsaren kan cacha)
CACHE_HEADERS = {"Cache-Control": "private, max-age=3600"}

app = FastAPI(
    title="Gravregister – digitalisering",
    description="PoC för att digitalisera skannade gravregister (HKG/HKN).",
)


@app.on_event("startup")
def startup():
    init_db()


def _mapp_path(mapp_namn: str) -> Path:
    """Sökväg till en källdata-mapp. Säkerställ att vi inte lämnar källdata."""
    path = (KÄLLDATA_DIR / mapp_namn).resolve()
    if not str(path).startswith(str(KÄLLDATA_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Ogiltig mapp")
    return path


def _pdf_sidnummer(filnamn: str) -> int:
    """Extrahera numeriskt sidnummer från t.ex. 1.pdf, 42.pdf."""
    try:
        return int(Path(filnamn).stem)
    except ValueError:
        return 0


def _effective_content_filer(
    pdf_filer: list[Path],
    offset: int,
    excluded_filenames: set[str],
) -> list[Path]:
    """Innehållsfiler efter försättssidor och exkluderat extramaterial."""
    after_forsett = pdf_filer[offset:] if offset <= len(pdf_filer) else []
    return [f for f in after_forsett if f.name not in excluded_filenames]


def _content_page_to_path(
    pdf_filer: list[Path],
    offset: int,
    excluded_filenames: set[str],
    sida_nummer: int,
) -> Path | None:
    """Mappa 1-baserat innehållssidanummer till faktisk PDF-path (med extramaterial exkluderat)."""
    effective = _effective_content_filer(pdf_filer, offset, excluded_filenames)
    if sida_nummer < 1 or sida_nummer > len(effective):
        return None
    return effective[sida_nummer - 1]


@app.get("/")
async def root():
    """Huvudsida – servera enkel frontend."""
    return FileResponse(Path(__file__).parent.parent / "static" / "index.html")


@app.get("/api/mappar")
async def list_mappar():
    """
    Lista undermappar under källdata.
    Varje mapp = ett PDF-arkiv (en kyrkogård/gravkvarter).
    """
    if not KÄLLDATA_DIR.exists():
        return {"mappar": []}
    mappar = [
        d.name
        for d in KÄLLDATA_DIR.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    ]
    return {"mappar": sorted(mappar)}


@app.get("/api/mappar/{mapp_namn}/filer")
async def list_pdf_filer(mapp_namn: str, db: Session = Depends(get_db)):
    """Lista PDF-filer och extramaterial. effective_filer = efter försätt, utan extramaterial."""
    mapp = _mapp_path(mapp_namn)
    if not mapp.exists():
        raise HTTPException(status_code=404, detail="Mappen finns inte")
    pdf_paths = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    filer = [f.name for f in pdf_paths]
    # Hämta extramaterial för denna mapp
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    extramaterial_list = []
    excluded = set()
    if mapp_config:
        for em in db.query(Extramaterial).filter(Extramaterial.mapp_id == mapp_config.id).all():
            extramaterial_list.append({"filnamn": em.filnamn, "typ": em.typ, "grav_start_sida": em.grav_start_sida})
            excluded.add(em.filnamn)
    # effective_filer = alla PDF:er (frontend applicerar offset själv men behöver veta vilka som är extramaterial)
    effective_filer = [f.name for f in pdf_paths if f.name not in excluded]
    return {
        "mapp": mapp_namn,
        "filer": filer,
        "extramaterial": extramaterial_list,
        "effective_filer": effective_filer,
    }


def _excluded_filenames_for_mapp(db: Session, mapp_namn: str) -> set[str]:
    """Set med filnamn som är extramaterial i denna mapp."""
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return set()
    return {em.filnamn for em in db.query(Extramaterial).filter(Extramaterial.mapp_id == mapp_config.id).all()}


@app.get("/api/mappar/{mapp_namn}/sida/{sida_nummer}")
async def pdf_sida_bild(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """
    Returnera en PDF-sida som PNG. sida_nummer = 1-baserat innehållssida (extramaterial exkluderat).
    """
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    mapp = _mapp_path(mapp_namn)
    pdf_filer = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    pdf_path = _content_page_to_path(pdf_filer, offset, excluded, sida_nummer)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    doc = fitz.open(pdf_path)
    try:
        page = doc[0]  # en sida per PDF
        pix = page.get_pixmap(dpi=150)
        png_bytes = pix.tobytes("png")
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    finally:
        doc.close()


@app.get("/api/mappar/{mapp_namn}/sida/{sida_nummer}/halva")
async def pdf_sida_halva(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
    halva: str = "nedre",
    split: float = 0.5,
    db: Session = Depends(get_db),
):
    """Returnera övre eller nedre del av en PDF-sida som PNG (extramaterial exkluderat)."""
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    if halva not in ("nedre", "ovre"):
        raise HTTPException(status_code=400, detail="halva måste vara nedre eller ovre")
    if not 0 < split < 1:
        raise HTTPException(status_code=400, detail="split måste vara mellan 0 och 1")
    mapp = _mapp_path(mapp_namn)
    pdf_filer = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    pdf_path = _content_page_to_path(pdf_filer, offset, excluded, sida_nummer)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    doc = fitz.open(pdf_path)
    try:
        page = doc[0]
        r = page.rect
        # PyMuPDF: origo upp till vänster, y nedåt
        if halva == "ovre":
            clip = fitz.Rect(0, 0, r.width, r.height * split)
        else:
            clip = fitz.Rect(0, r.height * split, r.width, r.height)
        pix = page.get_pixmap(dpi=150, clip=clip)
        png_bytes = pix.tobytes("png")
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    finally:
        doc.close()


@app.get("/api/mappar/{mapp_namn}/pdf/{sida_nummer}")
async def pdf_fil(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """Returnera själva PDF-filen (innehållssida, extramaterial exkluderat)."""
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    mapp = _mapp_path(mapp_namn)
    pdf_filer = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    pdf_path = _content_page_to_path(pdf_filer, offset, excluded, sida_nummer)
    if pdf_path is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=pdf_path.name,
    )


# ---------- API: mappkonfiguration och extramaterial ----------


class MappConfigSchema(BaseModel):
    kyrkogard: str | None = None
    gravkvarter: str | None = None
    forsett_antal: int = 0


class ExtramaterialSchema(BaseModel):
    filnamn: str
    typ: str | None = None  # valfri fritext
    grav_start_sida: int | None = None  # null = endast knutet till mappen


@app.get("/api/mappar/{mapp_namn}/config")
async def get_mapp_config(mapp_namn: str, db: Session = Depends(get_db)):
    """Hämta sparad konfiguration för mappen (kyrkogård, gravkvarter, försättssidor)."""
    _mapp_path(mapp_namn)  # validera
    row = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not row:
        return {"mapp": mapp_namn, "kyrkogard": None, "gravkvarter": None, "forsett_antal": 0}
    return {
        "mapp": mapp_namn,
        "kyrkogard": row.kyrkogard,
        "gravkvarter": row.gravkvarter,
        "forsett_antal": row.forsett_antal,
    }


@app.post("/api/mappar/{mapp_namn}/config")
async def save_mapp_config(
    mapp_namn: str,
    body: MappConfigSchema,
    db: Session = Depends(get_db),
):
    """Spara konfiguration för mappen."""
    _mapp_path(mapp_namn)
    row = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not row:
        row = MappConfig(namn=mapp_namn)
        db.add(row)
    row.kyrkogard = body.kyrkogard
    row.gravkvarter = body.gravkvarter
    row.forsett_antal = max(0, min(2, body.forsett_antal))
    db.commit()
    return {"ok": True}


@app.get("/api/mappar/{mapp_namn}/extramaterial")
async def list_extramaterial(mapp_namn: str, db: Session = Depends(get_db)):
    """Lista alla extramaterial för mappen."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return {"extramaterial": []}
    items = db.query(Extramaterial).filter(Extramaterial.mapp_id == mapp_config.id).all()
    return {
        "extramaterial": [
            {"id": em.id, "filnamn": em.filnamn, "typ": em.typ, "grav_start_sida": em.grav_start_sida}
            for em in items
        ],
    }


@app.get("/api/mappar/{mapp_namn}/extramaterial-mapp")
async def list_extramaterial_mapp(mapp_namn: str, db: Session = Depends(get_db)):
    """Lista extramaterial som endast är knutet till mappen (inte till en specifik grav)."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return {"extramaterial": []}
    items = (
        db.query(Extramaterial)
        .filter(Extramaterial.mapp_id == mapp_config.id, Extramaterial.grav_start_sida.is_(None))
        .all()
    )
    return {
        "extramaterial": [
            {"id": em.id, "filnamn": em.filnamn, "typ": em.typ}
            for em in items
        ],
    }


@app.get("/api/mappar/{mapp_namn}/fil/{filnamn}")
async def pdf_fil_efter_namn(mapp_namn: str, filnamn: str):
    """Returnera en PDF-fil efter filnamn (för att öppna t.ex. mapp-nivå extramaterial)."""
    if "/" in filnamn or "\\" in filnamn or ".." in filnamn:
        raise HTTPException(status_code=400, detail="Ogiltigt filnamn")
    mapp = _mapp_path(mapp_namn)
    if not mapp.exists():
        raise HTTPException(status_code=404, detail="Mappen finns inte")
    path = (mapp / filnamn).resolve()
    if not str(path).startswith(str(mapp.resolve())) or not path.is_file():
        raise HTTPException(status_code=404, detail="Filen finns inte")
    if path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=400, detail="Endast PDF-filer")
    return FileResponse(path, media_type="application/pdf", filename=path.name)


@app.post("/api/mappar/{mapp_namn}/extramaterial")
async def add_extramaterial(
    mapp_namn: str,
    body: ExtramaterialSchema,
    db: Session = Depends(get_db),
):
    """Registrera en PDF som extramaterial. grav_start_sida=null = endast knutet till mappen."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    em = Extramaterial(
        mapp_id=mapp_config.id,
        filnamn=body.filnamn.strip(),
        typ=body.typ.strip() or None if body.typ else None,
        grav_start_sida=body.grav_start_sida,
    )
    db.add(em)
    db.commit()
    return {"id": em.id, "filnamn": em.filnamn, "typ": em.typ, "grav_start_sida": em.grav_start_sida}


@app.delete("/api/mappar/{mapp_namn}/extramaterial/{em_id}")
async def delete_extramaterial(
    mapp_namn: str,
    em_id: int,
    db: Session = Depends(get_db),
):
    """Ta bort ett extramaterial."""
    _mapp_path(mapp_namn)
    em = db.query(Extramaterial).filter(Extramaterial.id == em_id).first()
    if not em:
        raise HTTPException(status_code=404, detail="Extramaterial hittades inte")
    db.delete(em)
    db.commit()
    return {"ok": True}


# Statiska filer (CSS, JS) och eventuella genererade bilder
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
