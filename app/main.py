"""FastAPI-app för gravregister-PoC."""
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import KÄLLDATA_DIR

# Cache-huvud för genererade bilder (1 timme; webbläsaren kan cacha)
CACHE_HEADERS = {"Cache-Control": "private, max-age=3600"}

app = FastAPI(
    title="Gravregister – digitalisering",
    description="PoC för att digitalisera skannade gravregister (HKG/HKN).",
)


def _mapp_path(mapp_namn: str) -> Path:
    """Sökväg till en källdata-mapp. Säkerställ att vi inte lämnar källdata."""
    path = (KÄLLDATA_DIR / mapp_namn).resolve()
    if not str(path).startswith(str(KÄLLDATA_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Ogiltig mapp")
    return path


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
async def list_pdf_filer(mapp_namn: str):
    """Lista PDF-filer i angiven mapp (sorterade efter sidnummer)."""
    mapp = _mapp_path(mapp_namn)
    if not mapp.exists():
        raise HTTPException(status_code=404, detail="Mappen finns inte")
    pdf_filer = sorted(
        [f.name for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda n: _pdf_sidnummer(n),
    )
    return {"mapp": mapp_namn, "filer": pdf_filer}


def _pdf_sidnummer(filnamn: str) -> int:
    """Extrahera numeriskt sidnummer från t.ex. 1.pdf, 42.pdf."""
    try:
        return int(Path(filnamn).stem)
    except ValueError:
        return 0


@app.get("/api/mappar/{mapp_namn}/sida/{sida_nummer}")
async def pdf_sida_bild(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
):
    """
    Returnera en PDF-sida som PNG-bild (för visning i webbläsaren).
    sida_nummer = 1-baserat innehållssida (första gravsidan = 1).
    offset = antal försättssidor att hoppa över (0, 1 eller 2).
    Faktisk fil = fil nr (offset + sida_nummer).
    """
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    mapp = _mapp_path(mapp_namn)
    pdf_filer = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    fil_index = offset + sida_nummer  # 1-baserat
    if sida_nummer < 1 or fil_index > len(pdf_filer):
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    pdf_path = pdf_filer[fil_index - 1]
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
    halva: str = "nedre",  # "nedre" eller "ovre"
    split: float = 0.5,  # andel av sidhöjd som är "övre" (0–1). T.ex. 0.455 för sida 1/3, 0.545 för sida 2
):
    """
    Returnera övre eller nedre del av en PDF-sida som PNG.
    split = andel av sidhöjd som räknas som övre (baserat på uppmätt layout).
    Övre = 0 till split·höjd, nedre = split·höjd till höjd.
    """
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
    fil_index = offset + sida_nummer
    if sida_nummer < 1 or fil_index > len(pdf_filer):
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    pdf_path = pdf_filer[fil_index - 1]
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
):
    """
    Returnera själva PDF-filen (för nedladdning/öppning i webbläsaren).
    sida_nummer = 1-baserat innehållssida. offset = antal försättssidor.
    """
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    mapp = _mapp_path(mapp_namn)
    pdf_filer = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    fil_index = offset + sida_nummer
    if sida_nummer < 1 or fil_index > len(pdf_filer):
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    pdf_path = pdf_filer[fil_index - 1]
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=pdf_path.name,
    )


# Statiska filer (CSS, JS) och eventuella genererade bilder
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
