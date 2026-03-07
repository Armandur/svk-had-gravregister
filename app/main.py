"""FastAPI-app för gravregister-PoC."""
import base64
import os
import re
import signal
import sys
import threading
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, tuple_, update
from sqlalchemy.orm import Session

from app.config import KÄLLDATA_DIR
from app.database import (
    SessionLocal,
    MappConfig,
    Extramaterial,
    InfogadTomSida,
    MappFilOrdning,
    MappSidaRedanHalva,
    Gravplats,
    GravplatsDoldHalva,
    GravplatsInmatning,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    GravplatsSkiss,
    Gravsatt,
    init_db,
    get_db,
)

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
    """Startsida – meny till programmets delar."""
    return FileResponse(Path(__file__).parent.parent / "static" / "index.html")


@app.get("/listvy")
async def listvy_sida():
    """Grunddatahantering – välj mapp, bläddra sidor, registrera gravplatser."""
    return FileResponse(Path(__file__).parent.parent / "static" / "listvy.html")


@app.get("/gravplatser")
@app.get("/gravplatser/{gravplats_slug:path}")
async def gravplatser_sida(gravplats_slug: str | None = None):
    """Trädvy på /gravplatser; visar en gravplats på /gravplatser/{slug}; sök på /gravplatser/sok."""
    if gravplats_slug == "sok":
        return FileResponse(Path(__file__).parent.parent / "static" / "gravplatser-sok.html")
    if gravplats_slug is None:
        return FileResponse(Path(__file__).parent.parent / "static" / "gravplatser-trad.html")
    return FileResponse(Path(__file__).parent.parent / "static" / "gravplatser-visa.html")


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


@app.get("/api/statistik")
async def get_statistik(db: Session = Depends(get_db)):
    """
    Aggregerad statistik för startsidan: mappar, PDF:er, gravplatser (saknar/fullständigt),
    extramaterial, gravrättsinnehavare, närmast anhöriga, gravsatta.
    """
    # Antal mappar (arkivvolymer)
    if not KÄLLDATA_DIR.exists():
        antal_mappar = 0
        antal_pdf = 0
    else:
        mappar = [
            d.name
            for d in KÄLLDATA_DIR.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        ]
        antal_mappar = len(mappar)
        antal_pdf = 0
        for mapp_namn in mappar:
            try:
                names = _sorted_pdf_names(mapp_namn)
                antal_pdf += len(names)
            except Exception:
                pass

    # Gravplatser som saknar kyrkogård, kvarter eller gravplatsnummer
    saknar = or_(
        Gravplats.kyrkogard.is_(None),
        Gravplats.kyrkogard == "",
        Gravplats.kvarter == "",
        Gravplats.gravplatsnummer == "",
    )
    gravplatser_saknar = db.query(Gravplats).filter(saknar).count()

    # Gravplatser med fullständigt gravplatsnummer (alla tre fält ifyllda)
    fullstandigt = and_(
        Gravplats.kyrkogard.isnot(None),
        Gravplats.kyrkogard != "",
        Gravplats.kvarter != "",
        Gravplats.gravplatsnummer != "",
    )
    gravplatser_fullstandiga = db.query(Gravplats).filter(fullstandigt).count()

    antal_extramaterial = db.query(Extramaterial).count()
    antal_innehavare = db.query(GravplatsInnehavare).count()
    antal_narmast_anhoriga = db.query(GravplatsNarmastAnhorig).count()
    antal_gravsatta = db.query(Gravsatt).count()
    antal_fardigtranskriberade = db.query(GravplatsInmatning).filter(
        GravplatsInmatning.fardigtranskriberad == True
    ).count()

    total_gravplatser = db.query(Gravplats).count()

    return {
        "antal_mappar": antal_mappar,
        "antal_pdf": antal_pdf,
        "gravplatser_saknar_kyrkogard_kvarter_eller_nummer": gravplatser_saknar,
        "gravplatser_fullstandiga": gravplatser_fullstandiga,
        "gravplatser_fardigtranskriberade": antal_fardigtranskriberade,
        "total_gravplatser": total_gravplatser,
        "antal_extramaterial": antal_extramaterial,
        "antal_innehavare": antal_innehavare,
        "antal_narmast_anhoriga": antal_narmast_anhoriga,
        "antal_gravsatta": antal_gravsatta,
    }


@app.get("/api/mappar/{mapp_namn}/filer")
async def list_pdf_filer(mapp_namn: str, db: Session = Depends(get_db)):
    """Lista PDF-filer och extramaterial. effective_filer = expanderad lista (filer + infogade tomma sidor)."""
    mapp = _mapp_path(mapp_namn)
    if not mapp.exists():
        raise HTTPException(status_code=404, detail="Mappen finns inte")
    pdf_paths = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    filer = [f.name for f in pdf_paths]
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    extramaterial_list = []
    excluded = set()
    if mapp_config:
        for em in db.query(Extramaterial).filter(Extramaterial.mapp_id == mapp_config.id).all():
            extramaterial_list.append({
                "id": em.id,
                "filnamn": em.filnamn,
                "typ": em.typ,
                "grav_start_sida": em.grav_start_sida,
                "redan_halva": getattr(em, "redan_halva", False),
            })
            excluded.add(em.filnamn)
    effective_filer = _expanded_effective_list(mapp_namn, excluded, db)
    redan_halva_set = _redan_halva_filenames_for_mapp(db, mapp_config.id if mapp_config else None)
    for item in effective_filer:
        if item.get("t") == "f":
            item["redan_halva"] = item.get("v", "") in redan_halva_set
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


def _redan_halva_filenames_for_mapp(db: Session, mapp_config_id: int | None) -> set[str]:
    """Set med filnamn som är markerade som 'redan halva' i flödet (visas som en bild, ordningen behålls)."""
    if not mapp_config_id:
        return set()
    return {
        r.filnamn
        for r in db.query(MappSidaRedanHalva).filter(MappSidaRedanHalva.mapp_id == mapp_config_id).all()
    }


def _parse_exclude_param(exclude: str | None) -> set[str]:
    """Temporärt urklipp från frontend – kommaseparerade filnamn som ska exkluderas från flödet."""
    if not exclude or not exclude.strip():
        return set()
    return {x.strip() for x in exclude.split(",") if x.strip()}


def _sorted_pdf_names(mapp_namn: str) -> list[str]:
    """Sorterad lista av PDF-filnamn i mappen (efter sidnummer)."""
    mapp = _mapp_path(mapp_namn)
    if not mapp.exists():
        return []
    paths = sorted(
        [f for f in mapp.iterdir() if f.suffix.lower() == ".pdf"],
        key=lambda f: _pdf_sidnummer(f.name),
    )
    return [f.name for f in paths]


def _ordered_pdf_names(mapp_namn: str, db: Session) -> list[str]:
    """PDF-filnamn i ordning: anpassad ordning (MappFilOrdning) om sådan finns, annars naturlig sortering."""
    base = _sorted_pdf_names(mapp_namn)
    if not base:
        return []
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return base
    order_rows = (
        db.query(MappFilOrdning)
        .filter(MappFilOrdning.mapp_id == mapp_config.id)
        .order_by(MappFilOrdning.position)
        .all()
    )
    if not order_rows:
        return base
    # Anpassad ordning: filer som finns i tabellen i position, övriga sist i naturlig ordning
    ordered = [r.filnamn for r in order_rows if r.filnamn in base]
    seen = set(ordered)
    for n in base:
        if n not in seen:
            ordered.append(n)
    return ordered


def _expanded_effective_list(
    mapp_namn: str, excluded: set[str], db: Session
) -> list[dict]:
    """
    Lista av innehållsposter: antingen {"t": "f", "v": filnamn} eller {"t": "b", "id": id}.
    Blanka sidor infogas efter den fil som anges i InfogadTomSida.efter_filnamn.
    """
    names = _ordered_pdf_names(mapp_namn, db)
    names = [n for n in names if n not in excluded]
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    blanks_after: dict[str, list[int]] = {}
    if mapp_config:
        for row in (
            db.query(InfogadTomSida)
            .filter(InfogadTomSida.mapp_id == mapp_config.id)
            .order_by(InfogadTomSida.id)
            .all()
        ):
            blanks_after.setdefault(row.efter_filnamn, []).append(row.id)
    out: list[dict] = []
    for filnamn in names:
        out.append({"t": "f", "v": filnamn})
        for bid in blanks_after.get(filnamn, []):
            out.append({"t": "b", "id": bid})
    return out


def _effective_filer_names(mapp_namn: str, excluded: set[str]) -> list[str]:
    """Innehållsfiler (sorterade) exkl. exkluderade filnamn. Används där expanded list inte behövs."""
    names = _sorted_pdf_names(mapp_namn)
    return [n for n in names if n not in excluded]


def _content_page_1based_in_expanded(filnamn: str, expanded: list[dict]) -> int | None:
    """1-baserat innehållssidanummer för första förekomsten av filnamn i expanded list."""
    for i, item in enumerate(expanded):
        if item.get("t") == "f" and item.get("v") == filnamn:
            return i + 1
    return None


def _content_page_to_item(
    mapp_namn: str,
    excluded: set[str],
    sida_nummer: int,
    db: Session,
) -> tuple[str, Path | int] | None:
    """
    Mappa 1-baserat innehållssida till post. Returnerar ("file", Path) eller ("blank", id) eller None.
    """
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    if sida_nummer < 1 or sida_nummer > len(expanded):
        return None
    item = expanded[sida_nummer - 1]
    if item["t"] == "b":
        return ("blank", item["id"])
    mapp = _mapp_path(mapp_namn)
    path = mapp / item["v"]
    if not path.is_file():
        return None
    return ("file", path)


def _blank_page_png_bytes(dpi: int = 150, split: float | None = None, halva: str | None = None) -> bytes:
    """Generera PNG för en tom sida (A4-liknande). Om split/halva anges returneras övre eller nedre halva."""
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)  # A4
    if split is not None and halva:
        r = page.rect
        if halva == "ovre":
            clip = fitz.Rect(0, 0, r.width, r.height * split)
        else:
            clip = fitz.Rect(0, r.height * split, r.width, r.height)
        pix = page.get_pixmap(dpi=dpi, clip=clip)
    else:
        pix = page.get_pixmap(dpi=dpi)
    png_bytes = pix.tobytes("png")
    doc.close()
    return png_bytes


def _content_page_1based(filnamn: str, effective_names: list[str]) -> int | None:
    """1-baserat innehållssidanummer för filnamn i listan, eller None om inte med."""
    try:
        i = effective_names.index(filnamn)
        return i + 1
    except ValueError:
        return None


def _shift_grav_start_efter_tillagg(db: Session, mapp_config_id: int, efter_sida: int) -> None:
    """Minska grav_start_sida med 1 för alla extramaterial i mappen som har grav_start_sida > efter_sida."""
    db.execute(
        update(Extramaterial)
        .where(
            Extramaterial.mapp_id == mapp_config_id,
            Extramaterial.grav_start_sida.isnot(None),
            Extramaterial.grav_start_sida > efter_sida,
        )
        .values(grav_start_sida=Extramaterial.grav_start_sida - 1)
    )


def _shift_grav_start_efter_borttag(db: Session, mapp_config_id: int, fran_och_med_sida: int) -> None:
    """Öka grav_start_sida med 1 för alla extramaterial i mappen som har grav_start_sida >= fran_och_med_sida."""
    db.execute(
        update(Extramaterial)
        .where(
            Extramaterial.mapp_id == mapp_config_id,
            Extramaterial.grav_start_sida.isnot(None),
            Extramaterial.grav_start_sida >= fran_och_med_sida,
        )
        .values(grav_start_sida=Extramaterial.grav_start_sida + 1)
    )


@app.get("/api/mappar/{mapp_namn}/sida/{sida_nummer}")
async def pdf_sida_bild(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
    exclude: str | None = None,
    db: Session = Depends(get_db),
):
    """
    Returnera en PDF-sida som PNG. sida_nummer = 1-baserat innehållssida.
    Vid infogad tom sida returneras en genererad tom sidbild.
    """
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn) | _parse_exclude_param(exclude)
    item = _content_page_to_item(mapp_namn, excluded, sida_nummer, db)
    if item is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    typ, val = item
    if typ == "blank":
        png_bytes = _blank_page_png_bytes(dpi=150)
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    doc = fitz.open(val)
    try:
        page = doc[0]
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
    exclude: str | None = None,
    db: Session = Depends(get_db),
):
    """Returnera övre eller nedre del av en PDF-sida som PNG. Vid tom sida returneras motsvarande halva."""
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    if halva not in ("nedre", "ovre"):
        raise HTTPException(status_code=400, detail="halva måste vara nedre eller ovre")
    if not 0 < split < 1:
        raise HTTPException(status_code=400, detail="split måste vara mellan 0 och 1")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn) | _parse_exclude_param(exclude)
    item = _content_page_to_item(mapp_namn, excluded, sida_nummer, db)
    if item is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    typ, val = item
    if typ == "blank":
        png_bytes = _blank_page_png_bytes(dpi=150, split=split, halva=halva)
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    doc = fitz.open(val)
    try:
        page = doc[0]
        mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
        redan_halva_set = _redan_halva_filenames_for_mapp(db, mapp_config.id if mapp_config else None)
        if val.name in redan_halva_set:
            pix = page.get_pixmap(dpi=150)
        else:
            r = page.rect
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
    exclude: str | None = None,
    db: Session = Depends(get_db),
):
    """Returnera själva PDF-filen (innehållssida). Vid tom sida returneras 404 (ingen PDF)."""
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn) | _parse_exclude_param(exclude)
    item = _content_page_to_item(mapp_namn, excluded, sida_nummer, db)
    if item is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    typ, val = item
    if typ == "blank":
        raise HTTPException(status_code=404, detail="Tom sida – ingen PDF att ladda")
    return FileResponse(
        val,
        media_type="application/pdf",
        filename=val.name,
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
    redan_halva: bool = False  # True = kort redan skannat som en halva, visas som halva i gravplatsvy


class ExtramaterialPatchSchema(BaseModel):
    redan_halva: bool | None = None
    dold: bool | None = None
    kommentar: str | None = None


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
    """Spara konfiguration för mappen (kyrkogård, kvarter, försättssidor)."""
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


# ---------- Gravplatsregistrering (kyrkogård + kvarter + gravplatsnummer per tre-sidors block) ----------


class GravplatsSchema(BaseModel):
    kvarter: str = ""
    gravplatsnummer: str = ""
    start_sida: int  # 1-baserat
    sida1_ovre_tillhor_denna: bool = False
    sida3_ovre_tillhor_nasta: bool = False


@app.get("/api/mappar/{mapp_namn}/gravplats")
async def list_gravplats(mapp_namn: str, start_sida: int | None = None, db: Session = Depends(get_db)):
    """Lista registrerade gravplatser för mappen. Om start_sida anges returneras endast posten för det blocket."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return {"gravplatser": []}
    q = db.query(Gravplats).filter(Gravplats.mapp_id == mapp_config.id)
    if start_sida is not None:
        q = q.filter(Gravplats.start_sida == start_sida)
    items = q.order_by(Gravplats.start_sida).all()
    return {
        "gravplatser": [
            {
                "id": g.id,
                "kvarter": g.kvarter,
                "gravplatsnummer": g.gravplatsnummer,
                "start_sida": g.start_sida,
                "kyrkogard": g.kyrkogard,
                "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
                "sida1_ovre_tillhor_denna": getattr(g, "sida1_ovre_tillhor_denna", False),
                "sida3_ovre_tillhor_nasta": getattr(g, "sida3_ovre_tillhor_nasta", False),
            }
            for g in items
        ],
    }


@app.get("/api/gravplatser/trad")
async def gravplatser_trad(db: Session = Depends(get_db)):
    """Trädstruktur: kyrkogårdar med underliggande kvarter (distinct från registrerade gravplatser) och antal gravplatser."""
    rows = (
        db.query(Gravplats.kyrkogard, Gravplats.kvarter)
        .filter(Gravplats.kyrkogard.isnot(None), Gravplats.kyrkogard != "")
        .distinct()
        .all()
    )
    trad: dict[str, list[str]] = {}
    for kyrkogard, kvarter in rows:
        k = (kyrkogard or "").strip()
        kv = (kvarter or "").strip()
        if not k:
            continue
        if k not in trad:
            trad[k] = []
        if kv and kv not in trad[k]:
            trad[k].append(kv)
    for k in trad:
        trad[k] = sorted(trad[k], key=lambda x: (x.lower(), x))
    # Sortera kyrkogårdar (t.ex. HKG, HKN)
    kyrkogardar = sorted(trad.keys(), key=lambda x: (x.upper(), x))

    # Antal gravplatser per kyrkogård och kvarter
    count_rows = (
        db.query(Gravplats.kyrkogard, Gravplats.kvarter, func.count(Gravplats.id).label("antal"))
        .filter(Gravplats.kyrkogard.isnot(None), Gravplats.kyrkogard != "")
        .group_by(Gravplats.kyrkogard, Gravplats.kvarter)
        .all()
    )
    antal_per_kvarter: dict[str, dict[str, int]] = {}
    antal_per_kyrkogard: dict[str, int] = {}
    for kyrkogard, kvarter, antal in count_rows:
        k = (kyrkogard or "").strip()
        kv = (kvarter or "").strip()
        if not k:
            continue
        if k not in antal_per_kvarter:
            antal_per_kvarter[k] = {}
        if kv:
            antal_per_kvarter[k][kv] = antal
        antal_per_kyrkogard[k] = antal_per_kyrkogard.get(k, 0) + antal

    return {
        "kyrkogardar": kyrkogardar,
        "kvarter_per_kyrkogard": {k: trad[k] for k in kyrkogardar},
        "antal_per_kvarter": antal_per_kvarter,
        "antal_per_kyrkogard": antal_per_kyrkogard,
    }


@app.get("/api/gravplatser/forslag/kyrkogardar")
async def forslag_kyrkogardar(q: str = "", limit: int = 30, db: Session = Depends(get_db)):
    """Lazy-förslag på kyrkogårdar (prefix-match)."""
    q = (q or "").strip()
    if not q:
        return {"forslag": []}
    rows = (
        db.query(Gravplats.kyrkogard)
        .filter(Gravplats.kyrkogard.isnot(None), Gravplats.kyrkogard != "")
        .filter(Gravplats.kyrkogard.ilike(q + "%"))
        .distinct()
        .order_by(Gravplats.kyrkogard)
        .limit(max(1, min(limit, 100)))
        .all()
    )
    forslag = [r[0].strip() for r in rows if r[0] and r[0].strip()]
    return {"forslag": forslag}


@app.get("/api/gravplatser/forslag/kvarter")
async def forslag_kvarter(
    q: str = "",
    kyrkogard: str | None = None,
    limit: int = 30,
    db: Session = Depends(get_db),
):
    """Lazy-förslag på kvarter (prefix-match). Valfritt filtrera på kyrkogård."""
    q = (q or "").strip()
    if not q:
        return {"forslag": []}
    query = (
        db.query(Gravplats.kvarter)
        .filter(Gravplats.kvarter.isnot(None), Gravplats.kvarter != "")
        .filter(Gravplats.kvarter.ilike(q + "%"))
    )
    if kyrkogard and kyrkogard.strip():
        query = query.filter(Gravplats.kyrkogard == kyrkogard.strip())
    rows = (
        query.distinct()
        .order_by(Gravplats.kvarter)
        .limit(max(1, min(limit, 100)))
        .all()
    )
    forslag = [r[0].strip() for r in rows if r[0] is not None and str(r[0]).strip()]
    return {"forslag": forslag}


@app.get("/api/gravplatser")
async def list_gravplats_global(
    kyrkogard: str,
    kvarter: str,
    db: Session = Depends(get_db),
):
    """Lista gravplatser för en kyrkogård och kvarter (över alla mappar). Returnerar mapp_namn per gravplats för halvor-API."""
    if not kyrkogard.strip() or not kvarter.strip():
        return {"gravplatser": []}
    items = (
        db.query(Gravplats, MappConfig.namn)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .filter(
            Gravplats.kyrkogard == kyrkogard.strip(),
            Gravplats.kvarter == kvarter.strip(),
        )
        .order_by(Gravplats.start_sida)
        .all()
    )
    out = []
    for g, mapp_namn in items:
        out.append({
            "id": g.id,
            "kvarter": g.kvarter,
            "gravplatsnummer": g.gravplatsnummer,
            "start_sida": g.start_sida,
            "kyrkogard": g.kyrkogard,
            "mapp_namn": mapp_namn,
            "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
        })
    # Sortera naturligt på gravplatsnummer (1, 2, 3+4, 5, 10 …)
    def ledande_tal(nr: str) -> int:
        s = (nr or "").strip()
        n = 0
        for c in s:
            if c.isdigit():
                n = n * 10 + int(c)
            elif n > 0:
                break
        return n if n > 0 else -1

    out.sort(key=lambda x: (ledande_tal(x.get("gravplatsnummer") or ""), (x.get("gravplatsnummer") or "")))
    return {"gravplatser": out}


@app.get("/api/gravplatser/sok")
async def sok_gravplatser(q: str = "", limit: int = 25, db: Session = Depends(get_db)):
    """
    Sök/förslag på gravplatser efter fullständigt gravplatsnummer (kyrkogård + kvarter + gravplatsnummer).
    q tolkas som prefix: "HKG" → kyrkogård som börjar på HKG, "HKG 01" → + kvarter som börjar på 01, etc.
    Returnerar lista för autocomplete.
    """
    q = (q or "").strip()
    if not q:
        return {"gravplatser": []}
    parts = [p.strip() for p in q.split() if p.strip()]
    qry = (
        db.query(Gravplats, MappConfig.namn)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .filter(Gravplats.kyrkogard.isnot(None), Gravplats.kyrkogard != "")
    )
    if len(parts) >= 1:
        qry = qry.filter(Gravplats.kyrkogard.ilike(parts[0] + "%"))
    if len(parts) >= 2:
        qry = qry.filter(Gravplats.kvarter.ilike(parts[1] + "%"))
    if len(parts) >= 3:
        qry = qry.filter(Gravplats.gravplatsnummer.ilike(parts[2] + "%"))
    items = (
        qry.order_by(Gravplats.kyrkogard, Gravplats.kvarter, Gravplats.start_sida)
        .limit(max(1, min(limit, 50)))
        .all()
    )
    def ledande_tal(nr: str) -> int:
        s = (nr or "").strip()
        n = 0
        for c in s:
            if c.isdigit():
                n = n * 10 + int(c)
            elif n > 0:
                break
        return n if n > 0 else -1
    out = []
    for g, mapp_namn in items:
        fullstandigt = _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer)
        out.append({
            "id": g.id,
            "kyrkogard": g.kyrkogard,
            "kvarter": g.kvarter,
            "gravplatsnummer": g.gravplatsnummer,
            "fullstandigt": fullstandigt,
            "mapp_namn": mapp_namn,
        })
    out.sort(key=lambda x: (x["kyrkogard"] or "", x["kvarter"] or "", ledande_tal(x.get("gravplatsnummer") or ""), (x.get("gravplatsnummer") or "")))
    return {"gravplatser": out}


def _ar_ur_datumstr(s: str | None) -> int | None:
    """
    Plocka ut fyrsiffrigt årtal ur en datumsträng (t.ex. 1800, 1800-01, 1800-01-15).
    Ofullständiga datum (endast år eller år-månad) räknas med utifrån året vid sökning mellan årtal.
    """
    if not s or not s.strip():
        return None
    # Matcha fyrsiffrigt årtal (t.ex. 1600–2099) så att ofullständiga datum inkluderas
    m = re.search(r"\b(1[6-9]\d{2}|20\d{2})\b", s.strip())
    return int(m.group(0)) if m else None


@app.get("/api/gravplatser/avancerad-sok")
async def avancerad_sok_gravplatser(
    db: Session = Depends(get_db),
    kyrkogard: str | None = None,
    kvarter: str | None = None,
    innehavare_fornamn: str | None = None,
    innehavare_efternamn: str | None = None,
    innehavare_yrke: str | None = None,
    anhorig_fornamn: str | None = None,
    anhorig_efternamn: str | None = None,
    gravsatt_fornamn: str | None = None,
    gravsatt_efternamn: str | None = None,
    gravsatt_fodda_fran: int | None = None,
    gravsatt_fodda_till: int | None = None,
    gravsatt_doda_fran: int | None = None,
    gravsatt_doda_till: int | None = None,
    gravsatt_gravsatta_fran: int | None = None,
    gravsatt_gravsatta_till: int | None = None,
    har_extramaterial: bool | None = None,
    utfardad_fran: int | None = None,
    utfardad_till: int | None = None,
    ej_fardigtranskriberad: bool | None = None,
    limit: int = 500,
):
    """
    Avancerad sökning: filtrera gravplatser på kyrkogård, kvarter, gravrättsinnehavare,
    närmast anhöriga, gravsatta (namn, födda/döda/begravda mellan årtal), extramaterial, graven utfärdad mellan årtal.
    """
    q = db.query(Gravplats).join(MappConfig, Gravplats.mapp_id == MappConfig.id)
    if kyrkogard and kyrkogard.strip():
        q = q.filter(Gravplats.kyrkogard.ilike("%" + kyrkogard.strip() + "%"))
    if kvarter and kvarter.strip():
        q = q.filter(Gravplats.kvarter.ilike("%" + kvarter.strip() + "%"))

    if innehavare_fornamn and innehavare_fornamn.strip():
        sq = (
            db.query(GravplatsInnehavare.gravplats_id)
            .filter(GravplatsInnehavare.fornamn.ilike("%" + innehavare_fornamn.strip() + "%"))
            .distinct()
        )
        q = q.filter(Gravplats.id.in_(sq))
    if innehavare_efternamn and innehavare_efternamn.strip():
        sq = (
            db.query(GravplatsInnehavare.gravplats_id)
            .filter(GravplatsInnehavare.efternamn.ilike("%" + innehavare_efternamn.strip() + "%"))
            .distinct()
        )
        q = q.filter(Gravplats.id.in_(sq))
    if innehavare_yrke and innehavare_yrke.strip():
        sq = (
            db.query(GravplatsInnehavare.gravplats_id)
            .filter(GravplatsInnehavare.yrke.ilike("%" + innehavare_yrke.strip() + "%"))
            .distinct()
        )
        q = q.filter(Gravplats.id.in_(sq))

    if anhorig_fornamn and anhorig_fornamn.strip():
        sq = (
            db.query(GravplatsNarmastAnhorig.gravplats_id)
            .filter(GravplatsNarmastAnhorig.fornamn.ilike("%" + anhorig_fornamn.strip() + "%"))
            .distinct()
        )
        q = q.filter(Gravplats.id.in_(sq))
    if anhorig_efternamn and anhorig_efternamn.strip():
        sq = (
            db.query(GravplatsNarmastAnhorig.gravplats_id)
            .filter(GravplatsNarmastAnhorig.efternamn.ilike("%" + anhorig_efternamn.strip() + "%"))
            .distinct()
        )
        q = q.filter(Gravplats.id.in_(sq))

    if gravsatt_fornamn and gravsatt_fornamn.strip():
        sq = (
            db.query(Gravsatt.gravplats_id)
            .filter(Gravsatt.fornamn.ilike("%" + gravsatt_fornamn.strip() + "%"))
            .distinct()
        )
        q = q.filter(Gravplats.id.in_(sq))
    if gravsatt_efternamn and gravsatt_efternamn.strip():
        sq = (
            db.query(Gravsatt.gravplats_id)
            .filter(Gravsatt.efternamn.ilike("%" + gravsatt_efternamn.strip() + "%"))
            .distinct()
        )
        q = q.filter(Gravplats.id.in_(sq))
    if gravsatt_fodda_fran is not None or gravsatt_fodda_till is not None:
        sq = db.query(Gravsatt.gravplats_id).distinct()
        if gravsatt_fodda_fran is not None:
            sq = sq.filter(Gravsatt.fodelse_ar >= gravsatt_fodda_fran)
        if gravsatt_fodda_till is not None:
            sq = sq.filter(Gravsatt.fodelse_ar <= gravsatt_fodda_till)
        q = q.filter(Gravplats.id.in_(sq))
    if gravsatt_doda_fran is not None or gravsatt_doda_till is not None:
        sq = db.query(Gravsatt.gravplats_id).distinct()
        if gravsatt_doda_fran is not None:
            sq = sq.filter(Gravsatt.dods_ar >= gravsatt_doda_fran)
        if gravsatt_doda_till is not None:
            sq = sq.filter(Gravsatt.dods_ar <= gravsatt_doda_till)
        q = q.filter(Gravplats.id.in_(sq))
    if gravsatt_gravsatta_fran is not None or gravsatt_gravsatta_till is not None:
        sub = db.query(Gravsatt.gravplats_id, Gravsatt.gravsatt_den).filter(
            Gravsatt.gravsatt_den != "", Gravsatt.gravsatt_den.isnot(None)
        ).all()
        gp_ids = set()
        for gid, den in sub:
            ar = _ar_ur_datumstr(den)
            if ar is None:
                continue
            if gravsatt_gravsatta_fran is not None and ar < gravsatt_gravsatta_fran:
                continue
            if gravsatt_gravsatta_till is not None and ar > gravsatt_gravsatta_till:
                continue
            gp_ids.add(gid)
        q = q.filter(Gravplats.id.in_(gp_ids)) if gp_ids else q.filter(False)

    if har_extramaterial:
        sub = (
            db.query(Extramaterial.mapp_id, Extramaterial.grav_start_sida)
            .filter(Extramaterial.grav_start_sida.isnot(None))
            .distinct()
            .all()
        )
        gp_with_em = set()
        for mapp_id, start_sida in sub:
            g = db.query(Gravplats.id).filter(
                Gravplats.mapp_id == mapp_id,
                Gravplats.start_sida == start_sida,
            ).first()
            if g:
                gp_with_em.add(g[0])
        if gp_with_em:
            q = q.filter(Gravplats.id.in_(gp_with_em))
        else:
            q = q.filter(False)

    if utfardad_fran is not None or utfardad_till is not None:
        sub = db.query(GravplatsInmatning.gravplats_id, GravplatsInmatning.utfordat_den).filter(
            GravplatsInmatning.utfordat_den != "", GravplatsInmatning.utfordat_den.isnot(None)
        ).all()
        gp_ids = set()
        for gid, den in sub:
            ar = _ar_ur_datumstr(den)
            if ar is None:
                continue
            if utfardad_fran is not None and ar < utfardad_fran:
                continue
            if utfardad_till is not None and ar > utfardad_till:
                continue
            gp_ids.add(gid)
        q = q.filter(Gravplats.id.in_(gp_ids)) if gp_ids else q.filter(False)

    if ej_fardigtranskriberad:
        # Visa endast gravplatser som inte är markerade som färdigtranskriberade (saknar rad eller fardigtranskriberad = False)
        subq = db.query(GravplatsInmatning.gravplats_id).filter(
            GravplatsInmatning.fardigtranskriberad == True
        ).distinct()
        q = q.filter(~Gravplats.id.in_(subq))

    q = q.distinct().order_by(Gravplats.kyrkogard, Gravplats.kvarter, Gravplats.start_sida).limit(max(1, min(limit, 5000)))
    rows = q.all()
    ids = [g.id for g in rows]
    inv_map = {}
    na_map = {}
    gs_map = {}
    utfordat_map = {}
    em_map = {}
    if ids:
        for gid, cnt in db.query(GravplatsInnehavare.gravplats_id, func.count(GravplatsInnehavare.id)).filter(
            GravplatsInnehavare.gravplats_id.in_(ids)
        ).group_by(GravplatsInnehavare.gravplats_id).all():
            inv_map[gid] = cnt
        for gid, cnt in db.query(GravplatsNarmastAnhorig.gravplats_id, func.count(GravplatsNarmastAnhorig.id)).filter(
            GravplatsNarmastAnhorig.gravplats_id.in_(ids)
        ).group_by(GravplatsNarmastAnhorig.gravplats_id).all():
            na_map[gid] = cnt
        for gid, cnt in db.query(Gravsatt.gravplats_id, func.count(Gravsatt.id)).filter(
            Gravsatt.gravplats_id.in_(ids)
        ).group_by(Gravsatt.gravplats_id).all():
            gs_map[gid] = cnt
        for gid, den in db.query(GravplatsInmatning.gravplats_id, GravplatsInmatning.utfordat_den).filter(
            GravplatsInmatning.gravplats_id.in_(ids)
        ).all():
            utfordat_map[gid] = den or ""
        pairs = [(g.mapp_id, g.start_sida) for g in rows]
        for mapp_id, start_sida, cnt in db.query(
            Extramaterial.mapp_id, Extramaterial.grav_start_sida, func.count(Extramaterial.id)
        ).filter(
            Extramaterial.grav_start_sida.isnot(None),
            tuple_(Extramaterial.mapp_id, Extramaterial.grav_start_sida).in_(pairs),
        ).group_by(Extramaterial.mapp_id, Extramaterial.grav_start_sida).all():
            em_map[(mapp_id, start_sida)] = cnt

    out = []
    for g in rows:
        mapp_namn = db.query(MappConfig.namn).filter(MappConfig.id == g.mapp_id).scalar() or ""
        antal_em = em_map.get((g.mapp_id, g.start_sida), 0)
        out.append({
            "id": g.id,
            "kyrkogard": g.kyrkogard,
            "kvarter": g.kvarter,
            "gravplatsnummer": g.gravplatsnummer,
            "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
            "mapp_namn": mapp_namn,
            "antal_innehavare": inv_map.get(g.id, 0),
            "antal_narmast_anhoriga": na_map.get(g.id, 0),
            "antal_gravsatta": gs_map.get(g.id, 0),
            "utfordat_den": utfordat_map.get(g.id, ""),
            "har_extramaterial": antal_em > 0,
            "antal_extramaterial": antal_em,
        })

    def ledande_tal(nr: str) -> int:
        s = (nr or "").strip()
        n = 0
        for c in s:
            if c.isdigit():
                n = n * 10 + int(c)
            elif n > 0:
                break
        return n if n > 0 else -1

    out.sort(key=lambda x: (x["kyrkogard"] or "", x["kvarter"] or "", ledande_tal(x.get("gravplatsnummer") or ""), (x.get("gravplatsnummer") or "")))
    return {"gravplatser": out, "antal": len(out)}


def _format_fullstandigt(kyrkogard: str | None, kvarter: str, gravplatsnummer: str) -> str:
    """Bygg fullständigt gravplatsnummer t.ex. HKN Allm 1+2."""
    parts = [p for p in (kyrkogard, kvarter.strip(), gravplatsnummer.strip()) if p]
    return " ".join(parts) if parts else ""


def _gravplats_halvor(g: Gravplats, foregaende_grav: Gravplats | None = None) -> list[dict]:
    """
    Lista vilka halvor (content_sida + nedre/ovre) som tillhör denna gravplats.
    Standard: sida 1 nedre (gravrätt), sida 2 nedre (gravsatta 1–5), sida 3 övre (gravsatta 6–10).
    sida1_ovre_tillhor_denna: inkludera även sida 1 övre.
    sida3_ovre_tillhor_nasta: sida 3 övre tillhör nästa grav, exkludera den här.
    Om foregaende_grav har sida3_ovre_tillhor_nasta så tillhör övre halvan av vår sida 1 (gravsatta 6–10 från föreg. sida) denna grav – visas sist.
    """
    s1, s2, s3 = g.start_sida, g.start_sida + 1, g.start_sida + 2
    halvor = [
        {"content_sida": s1, "halva": "nedre", "typ": "gravrätt"},
        {"content_sida": s2, "halva": "nedre", "typ": "gravsatta_1_5"},
    ]
    if getattr(g, "sida1_ovre_tillhor_denna", False):
        halvor.append({"content_sida": s1, "halva": "ovre", "typ": "gravrätt_ovre"})
    if not getattr(g, "sida3_ovre_tillhor_nasta", False):
        halvor.append({"content_sida": s3, "halva": "ovre", "typ": "gravsatta_6_10"})
    if foregaende_grav and getattr(foregaende_grav, "sida3_ovre_tillhor_nasta", False):
        halvor.append({"content_sida": s1, "halva": "ovre", "typ": "gravsatta_6_10_fran_foregaende_sida"})
    return halvor


@app.get("/api/mappar/{mapp_namn}/gravplats/halvor")
async def get_gravplats_halvor(
    mapp_namn: str,
    kyrkogard: str | None = None,
    kvarter: str | None = None,
    gravplatsnummer: str | None = None,
    db: Session = Depends(get_db),
):
    """
    Hämta vilka halvor som tillhör en gravplats (fullständigt id = kyrkogård + kvarter + gravplatsnummer).
    Returnerar gravplats plus lista med content_sida och halva (nedre/ovre) så att du kan bygga bild-URL:er.
    """
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        raise HTTPException(status_code=404, detail="Mappen hittades inte")
    q = db.query(Gravplats).filter(Gravplats.mapp_id == mapp_config.id)
    if kyrkogard is not None and kyrkogard.strip():
        q = q.filter(Gravplats.kyrkogard == kyrkogard.strip())
    if kvarter is not None and kvarter.strip():
        q = q.filter(Gravplats.kvarter == kvarter.strip())
    if gravplatsnummer is not None and gravplatsnummer.strip():
        q = q.filter(Gravplats.gravplatsnummer == gravplatsnummer.strip())
    g = q.first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    foregaende = (
        db.query(Gravplats)
        .filter(
            Gravplats.mapp_id == mapp_config.id,
            Gravplats.start_sida == g.start_sida - 2,
        )
        .first()
    )
    halvor = _gravplats_halvor(g, foregaende)
    # Anrik med filnamn för varje content_sida (för knapp "öppna PDF" och "visa hela sidan")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    for h in halvor:
        sid = h.get("content_sida")
        if sid is not None and 1 <= sid <= len(expanded):
            item = expanded[sid - 1]
            if item.get("t") == "f":
                h["filnamn"] = item["v"]
    # Lägg till "färdiga halvor" – extramaterial markerade som redan_halva (kort skannade som en halva), exkludera dolda
    for em in (
        db.query(Extramaterial)
        .filter(
            Extramaterial.mapp_id == mapp_config.id,
            Extramaterial.grav_start_sida == g.start_sida,
            Extramaterial.redan_halva == True,
            Extramaterial.dold != True,
        )
        .order_by(Extramaterial.id)
    ):
        halvor.append({
            "redan_halva": True,
            "filnamn": em.filnamn,
            "typ": em.typ or "halva",
        })
    # Exkludera vanliga halvor som användaren dolt (gravplats_dold_halva)
    dold_halvor_rows = db.query(GravplatsDoldHalva).filter(GravplatsDoldHalva.gravplats_id == g.id).all()
    dold_halvor_set = {(r.content_sida, r.halva) for r in dold_halvor_rows}
    halvor = [h for h in halvor if (h.get("content_sida"), h.get("halva")) not in dold_halvor_set]
    # Alla extramaterial knutna till denna gravplats (ej dolda) – för utfällbar sektion
    extramaterial_lista = [
        {"id": em.id, "filnamn": em.filnamn, "typ": em.typ or "", "redan_halva": getattr(em, "redan_halva", False), "kommentar": getattr(em, "kommentar", None) or ""}
        for em in (
            db.query(Extramaterial)
            .filter(
                Extramaterial.mapp_id == mapp_config.id,
                Extramaterial.grav_start_sida == g.start_sida,
                Extramaterial.dold != True,
            )
            .order_by(Extramaterial.id)
        )
    ]
    # Dolda: (1) extramaterial med dold=true, (2) vanliga halvor som användaren dolt
    dolda_lista = []
    for em in (
        db.query(Extramaterial)
        .filter(
            Extramaterial.mapp_id == mapp_config.id,
            Extramaterial.grav_start_sida == g.start_sida,
            Extramaterial.dold == True,
        )
        .order_by(Extramaterial.id)
    ):
        dolda_lista.append({"type": "extramaterial", "id": em.id, "filnamn": em.filnamn, "typ": em.typ or ""})
    for r in dold_halvor_rows:
        filnamn = None
        if 1 <= r.content_sida <= len(expanded):
            item = expanded[r.content_sida - 1]
            if item.get("t") == "f":
                filnamn = item.get("v")
        dolda_lista.append({
            "type": "halva",
            "content_sida": r.content_sida,
            "halva": r.halva,
            "filnamn": filnamn or "",
        })
    return {
        "gravplats": {
            "id": g.id,
            "kyrkogard": g.kyrkogard,
            "kvarter": g.kvarter,
            "gravplatsnummer": g.gravplatsnummer,
            "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
            "start_sida": g.start_sida,
        },
        "halvor": halvor,
        "extramaterial": extramaterial_lista,
        "dolda": dolda_lista,
    }


class DoldHalvaBody(BaseModel):
    content_sida: int
    halva: str  # "nedre" | "ovre"


@app.post("/api/gravplats/{gravplats_id:int}/dold-halva")
async def post_dold_halva(gravplats_id: int, body: DoldHalvaBody, db: Session = Depends(get_db)):
    """Dölj en vanlig gravplatsbild (halva) från bildraden – den visas i sektion Dolda."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    existing = (
        db.query(GravplatsDoldHalva)
        .filter(
            GravplatsDoldHalva.gravplats_id == gravplats_id,
            GravplatsDoldHalva.content_sida == body.content_sida,
            GravplatsDoldHalva.halva == body.halva,
        )
        .first()
    )
    if not existing:
        row = GravplatsDoldHalva(gravplats_id=gravplats_id, content_sida=body.content_sida, halva=body.halva)
        db.add(row)
        db.commit()
    return {"ok": True}


@app.delete("/api/gravplats/{gravplats_id:int}/dold-halva")
async def delete_dold_halva(
    gravplats_id: int,
    content_sida: int,
    halva: str,
    db: Session = Depends(get_db),
):
    """Visa igen en dold vanlig gravplatsbild (ta bort från Dolda)."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    db.query(GravplatsDoldHalva).filter(
        GravplatsDoldHalva.gravplats_id == gravplats_id,
        GravplatsDoldHalva.content_sida == content_sida,
        GravplatsDoldHalva.halva == halva,
    ).delete()
    db.commit()
    return {"ok": True}


@app.post("/api/mappar/{mapp_namn}/gravplats")
async def save_gravplats(
    mapp_namn: str,
    body: GravplatsSchema,
    db: Session = Depends(get_db),
):
    """Spara eller uppdatera gravplats för ett tre-sidors block. Kyrkogård hämtas från mappens config."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    kyrkogard = mapp_config.kyrkogard or None
    existing = (
        db.query(Gravplats)
        .filter(Gravplats.mapp_id == mapp_config.id, Gravplats.start_sida == body.start_sida)
        .first()
    )
    kvarter = body.kvarter.strip() if body.kvarter else ""
    gravplatsnummer = body.gravplatsnummer.strip() if body.gravplatsnummer else ""
    if existing:
        existing.kvarter = kvarter
        existing.gravplatsnummer = gravplatsnummer
        existing.kyrkogard = kyrkogard
        existing.sida1_ovre_tillhor_denna = body.sida1_ovre_tillhor_denna
        existing.sida3_ovre_tillhor_nasta = body.sida3_ovre_tillhor_nasta
        db.commit()
        db.refresh(existing)
        g = existing
    else:
        g = Gravplats(
            mapp_id=mapp_config.id,
            kvarter=kvarter,
            gravplatsnummer=gravplatsnummer,
            start_sida=body.start_sida,
            kyrkogard=kyrkogard,
            sida1_ovre_tillhor_denna=body.sida1_ovre_tillhor_denna,
            sida3_ovre_tillhor_nasta=body.sida3_ovre_tillhor_nasta,
        )
        db.add(g)
        db.commit()
        db.refresh(g)
    return {
        "id": g.id,
        "kvarter": g.kvarter,
        "gravplatsnummer": g.gravplatsnummer,
        "start_sida": g.start_sida,
        "kyrkogard": g.kyrkogard,
        "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
        "sida1_ovre_tillhor_denna": g.sida1_ovre_tillhor_denna,
        "sida3_ovre_tillhor_nasta": g.sida3_ovre_tillhor_nasta,
    }


# ---------- Inmatning per gravplats (gravrättsinnehavare, gravsatta, närmast anhöriga) ----------


class InnehavareItem(BaseModel):
    fornamn: str = ""
    efternamn: str = ""
    yrke: str = ""
    adress: str = ""
    kommentar: str = ""
    sort_order: int = 0


class NarmastAnhorigItem(BaseModel):
    id: int | None = None
    fornamn: str = ""
    efternamn: str = ""
    yrke: str = ""
    adress: str = ""  # Gatuadress
    postnummer: str = ""
    postort: str = ""
    telefon: str = ""
    kommentar: str = ""
    sort_order: int = 0


class GravsattItem(BaseModel):
    id: int | None = None
    position: int = 0  # 1-based, sätts från ordning i listan
    ar_beteckning: bool = False
    fornamn: str = ""
    efternamn: str = ""
    yrke: str = ""
    adress: str = ""
    fodelse_ar: int | None = None
    fodelse_manad: int | None = None
    fodelse_dag: int | None = None
    fod_nr: str = ""
    dods_ar: int | None = None
    dods_manad: int | None = None
    dods_dag: int | None = None
    dodsbok_nr: str = ""
    gravsatt_den: str = ""
    urna: str = ""
    kommentar: str = ""


class InmatningSchema(BaseModel):
    innehavare: list[InnehavareItem] = []
    narmast_anhoriga: list[NarmastAnhorigItem] = []
    storlek: str = ""
    underhall_text: str = ""
    underhall_overstruket: bool = False
    gravrattstid: str = ""
    monument: str = ""
    gravens_utformning: str = ""
    karta_nr: str = ""
    gravbrev_nr: str = ""
    utfordat_den: str = ""
    kommentar: str = ""
    fardigtranskriberad: bool = False
    gravsatta: list[GravsattItem] = []
    skiss_bild_b64: str | None = None
    extramaterial_kommentarer: list[dict] = []  # [{"id": int, "kommentar": str}, ...]


def _inmatning_response(gravplats_id: int, db: Session) -> dict:
    """Bygg svar för GET inmatning."""
    row = db.query(GravplatsInmatning).filter(GravplatsInmatning.gravplats_id == gravplats_id).first()
    innehavare_rows = (
        db.query(GravplatsInnehavare)
        .filter(GravplatsInnehavare.gravplats_id == gravplats_id)
        .order_by(GravplatsInnehavare.sort_order, GravplatsInnehavare.id)
        .all()
    )
    def _inv_fornamn_efternamn(n):
        f = getattr(n, "fornamn", None) or ""
        e = getattr(n, "efternamn", None) or ""
        if not f and not e and getattr(n, "namn", None):
            return (n.namn or "", "")
        return (f or "", e or "")

    if not innehavare_rows and row and (row.gravrattsinnehavare or row.yrke or row.adress):
        fn, en = (row.gravrattsinnehavare or "", "") if row.gravrattsinnehavare else ("", "")
        innehavare_list = [{"fornamn": fn, "efternamn": en, "yrke": row.yrke or "", "adress": row.adress or "", "kommentar": "", "sort_order": 0}]
    else:
        innehavare_list = [
            {"fornamn": _inv_fornamn_efternamn(n)[0], "efternamn": _inv_fornamn_efternamn(n)[1], "yrke": n.yrke or "", "adress": n.adress or "", "kommentar": getattr(n, "kommentar", None) or "", "sort_order": n.sort_order}
            for n in innehavare_rows
        ]
    narmast = (
        db.query(GravplatsNarmastAnhorig)
        .filter(GravplatsNarmastAnhorig.gravplats_id == gravplats_id)
        .order_by(GravplatsNarmastAnhorig.sort_order, GravplatsNarmastAnhorig.id)
        .all()
    )
    gravsatta = (
        db.query(Gravsatt)
        .filter(Gravsatt.gravplats_id == gravplats_id)
        .order_by(Gravsatt.position)
        .all()
    )
    def _gs_fornamn_efternamn(g):
        f = getattr(g, "fornamn", None) or ""
        e = getattr(g, "efternamn", None) or ""
        if not f and not e and getattr(g, "namn", None):
            return (g.namn or "", "")
        return (f or "", e or "")

    gravsatta_list = [
        {
            "id": g.id,
            "position": g.position,
            "ar_beteckning": g.ar_beteckning,
            "fornamn": _gs_fornamn_efternamn(g)[0],
            "efternamn": _gs_fornamn_efternamn(g)[1],
            "yrke": getattr(g, "yrke", None) or "",
            "adress": g.adress,
            "fodelse_ar": g.fodelse_ar,
            "fodelse_manad": g.fodelse_manad,
            "fodelse_dag": g.fodelse_dag,
            "fod_nr": g.fod_nr,
            "dods_ar": g.dods_ar,
            "dods_manad": g.dods_manad,
            "dods_dag": g.dods_dag,
            "dodsbok_nr": g.dodsbok_nr,
            "gravsatt_den": g.gravsatt_den,
            "urna": g.urna,
            "kommentar": getattr(g, "kommentar", None) or "",
        }
        for g in gravsatta
    ]
    skisser_rows = (
        db.query(GravplatsSkiss)
        .filter(GravplatsSkiss.gravplats_id == gravplats_id)
        .order_by(GravplatsSkiss.sort_order, GravplatsSkiss.id)
        .all()
    )
    skisser_list = [
        {
            "id": s.id,
            "source_type": s.source_type,
            "content_sida": s.content_sida,
            "halva": s.halva,
            "extramaterial_id": s.extramaterial_id,
            "x": s.x,
            "y": s.y,
            "width": s.width,
            "height": s.height,
            "sort_order": s.sort_order,
        }
        for s in skisser_rows
    ]
    if not row:
        return {
            "gravplats_id": gravplats_id,
            "innehavare": innehavare_list,
            "narmast_anhoriga": [{"id": n.id, "fornamn": _inv_fornamn_efternamn(n)[0], "efternamn": _inv_fornamn_efternamn(n)[1], "yrke": getattr(n, "yrke", None) or "", "adress": n.adress or "", "postnummer": n.postnummer or "", "postort": n.postort or "", "telefon": n.telefon or "", "kommentar": getattr(n, "kommentar", None) or "", "sort_order": n.sort_order} for n in narmast],
            "storlek": "",
            "underhall_text": "",
            "underhall_overstruket": False,
            "gravrattstid": "",
            "monument": "",
            "gravens_utformning": "",
            "karta_nr": "",
            "gravbrev_nr": "",
            "utfordat_den": "",
            "kommentar": "",
            "fardigtranskriberad": False,
            "has_skiss": False,
            "gravsatta": gravsatta_list,
            "skisser": skisser_list,
        }
    return {
        "gravplats_id": gravplats_id,
        "innehavare": innehavare_list,
        "narmast_anhoriga": [{"id": n.id, "fornamn": _inv_fornamn_efternamn(n)[0], "efternamn": _inv_fornamn_efternamn(n)[1], "yrke": getattr(n, "yrke", None) or "", "adress": n.adress or "", "postnummer": n.postnummer or "", "postort": n.postort or "", "telefon": n.telefon or "", "kommentar": getattr(n, "kommentar", None) or "", "sort_order": n.sort_order} for n in narmast],
        "storlek": row.storlek or "",
        "underhall_text": row.underhall_text or "",
        "underhall_overstruket": row.underhall_overstruket,
        "gravrattstid": row.gravrattstid or "",
        "monument": row.monument or "",
        "gravens_utformning": row.gravens_utformning or "",
        "karta_nr": row.karta_nr or "",
        "gravbrev_nr": row.gravbrev_nr or "",
        "utfordat_den": row.utfordat_den or "",
        "kommentar": row.kommentar or "",
        "fardigtranskriberad": getattr(row, "fardigtranskriberad", False),
        "has_skiss": row.skiss_bild is not None and len(row.skiss_bild) > 0,
        "gravsatta": gravsatta_list,
        "skisser": skisser_list,
    }


@app.get("/api/gravplats/{gravplats_id:int}/inmatning")
async def get_inmatning(gravplats_id: int, db: Session = Depends(get_db)):
    """Hämta inmatad data för gravplatsen (gravrätt, närmast anhöriga, gravsatta 1–10)."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    return _inmatning_response(gravplats_id, db)


@app.put("/api/gravplats/{gravplats_id:int}/inmatning")
async def put_inmatning(gravplats_id: int, body: InmatningSchema, db: Session = Depends(get_db)):
    """Spara inmatad data för gravplatsen."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    row = db.query(GravplatsInmatning).filter(GravplatsInmatning.gravplats_id == gravplats_id).first()
    if not row:
        row = GravplatsInmatning(gravplats_id=gravplats_id)
        db.add(row)
        db.flush()
    row.storlek = body.storlek or ""
    row.underhall_text = body.underhall_text or ""
    row.underhall_overstruket = body.underhall_overstruket
    row.gravrattstid = body.gravrattstid or ""
    row.monument = body.monument or ""
    row.gravens_utformning = body.gravens_utformning or ""
    row.karta_nr = body.karta_nr or ""
    row.gravbrev_nr = body.gravbrev_nr or ""
    row.utfordat_den = body.utfordat_den or ""
    row.kommentar = body.kommentar or ""
    row.fardigtranskriberad = body.fardigtranskriberad
    if body.skiss_bild_b64 is not None:
        try:
            row.skiss_bild = base64.b64decode(body.skiss_bild_b64) if body.skiss_bild_b64 else None
        except Exception:
            pass
    db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id == gravplats_id).delete()
    for i, inv in enumerate(body.innehavare):
        fn, en = (inv.fornamn or "").strip(), (inv.efternamn or "").strip()
        db.add(GravplatsInnehavare(
            gravplats_id=gravplats_id,
            sort_order=i,
            namn=(fn + " " + en).strip(),
            fornamn=fn,
            efternamn=en,
            yrke=inv.yrke or "",
            adress=inv.adress or "",
            kommentar=inv.kommentar or "",
        ))
    db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id == gravplats_id).delete()
    for i, na in enumerate(body.narmast_anhoriga):
        fn, en = (na.fornamn or "").strip(), (na.efternamn or "").strip()
        if fn or en:
            db.add(GravplatsNarmastAnhorig(
                gravplats_id=gravplats_id,
                namn=(fn + " " + en).strip(),
                fornamn=fn,
                efternamn=en,
                yrke=na.yrke or "",
                adress=na.adress or "",
                postnummer=na.postnummer or "",
                postort=na.postort or "",
                telefon=na.telefon or "",
                sort_order=i,
                kommentar=na.kommentar or "",
            ))
    db.query(Gravsatt).filter(Gravsatt.gravplats_id == gravplats_id).delete()
    for i, gs in enumerate(body.gravsatta):
        pos = i + 1
        if pos > 10:
            break
        fn, en = (gs.fornamn or "").strip(), (gs.efternamn or "").strip()
        db.add(Gravsatt(
            gravplats_id=gravplats_id,
            position=pos,
            ar_beteckning=gs.ar_beteckning,
            namn=(fn + " " + en).strip(),
            fornamn=fn,
            efternamn=en,
            yrke=gs.yrke or "",
            adress=gs.adress or "",
            fodelse_ar=gs.fodelse_ar,
            fodelse_manad=gs.fodelse_manad,
            fodelse_dag=gs.fodelse_dag,
            fod_nr=gs.fod_nr or "",
            dods_ar=gs.dods_ar,
            dods_manad=gs.dods_manad,
            dods_dag=gs.dods_dag,
            dodsbok_nr=gs.dodsbok_nr or "",
            gravsatt_den=gs.gravsatt_den or "",
            urna=gs.urna or "",
            kommentar=gs.kommentar or "",
        ))
    for item in body.extramaterial_kommentarer or []:
        em_id = item.get("id") if isinstance(item, dict) else getattr(item, "id", None)
        kommentar = item.get("kommentar", "") if isinstance(item, dict) else getattr(item, "kommentar", "")
        if em_id is not None:
            em = db.query(Extramaterial).filter(
                Extramaterial.id == em_id,
                Extramaterial.mapp_id == g.mapp_id,
                Extramaterial.grav_start_sida == g.start_sida,
            ).first()
            if em:
                em.kommentar = (kommentar or "").strip() if isinstance(kommentar, str) else ""
    db.commit()
    return _inmatning_response(gravplats_id, db)


@app.get("/api/gravplats/{gravplats_id:int}/inmatning/skiss")
async def get_inmatning_skiss(gravplats_id: int, db: Session = Depends(get_db)):
    """Hämta skissbild för gravplatsen (PNG/JPEG). Äldre enkelskiss – använd skisser (koordinater) istället."""
    row = db.query(GravplatsInmatning).filter(GravplatsInmatning.gravplats_id == gravplats_id).first()
    if not row or not row.skiss_bild:
        raise HTTPException(status_code=404, detail="Ingen skiss")
    return Response(content=row.skiss_bild, media_type="image/png", headers=CACHE_HEADERS)


class SkissCreateBody(BaseModel):
    source_type: str  # "halva" | "extramaterial"
    content_sida: int | None = None
    halva: str | None = None  # "nedre" | "ovre"
    extramaterial_id: int | None = None
    x: float = 0.0
    y: float = 0.0
    width: float = 0.0
    height: float = 0.0


class SkissOrdningBody(BaseModel):
    skiss_ids: list[int]  # ordning = index i listan


@app.post("/api/gravplats/{gravplats_id:int}/skisser")
async def post_skiss(gravplats_id: int, body: SkissCreateBody, db: Session = Depends(get_db)):
    """Lägg till en skiss (rektangelmarkering på en bild)."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    if body.source_type not in ("halva", "extramaterial"):
        raise HTTPException(status_code=400, detail="source_type måste vara halva eller extramaterial")
    if body.source_type == "halva":
        if body.content_sida is None or body.halva not in ("nedre", "ovre"):
            raise HTTPException(status_code=400, detail="För halva krävs content_sida och halva (nedre/ovre)")
    if body.source_type == "extramaterial":
        if body.extramaterial_id is None:
            raise HTTPException(status_code=400, detail="För extramaterial krävs extramaterial_id")
    max_order = (
        db.query(func.max(GravplatsSkiss.sort_order))
        .filter(GravplatsSkiss.gravplats_id == gravplats_id)
        .scalar()
    )
    sort_order = (max_order or -1) + 1
    s = GravplatsSkiss(
        gravplats_id=gravplats_id,
        source_type=body.source_type,
        content_sida=body.content_sida,
        halva=body.halva,
        extramaterial_id=body.extramaterial_id,
        x=max(0, min(1, body.x)),
        y=max(0, min(1, body.y)),
        width=max(0, min(1, body.width)),
        height=max(0, min(1, body.height)),
        sort_order=sort_order,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {
        "id": s.id,
        "source_type": s.source_type,
        "content_sida": s.content_sida,
        "halva": s.halva,
        "extramaterial_id": s.extramaterial_id,
        "x": s.x,
        "y": s.y,
        "width": s.width,
        "height": s.height,
        "sort_order": s.sort_order,
    }


@app.put("/api/gravplats/{gravplats_id:int}/skisser/ordning")
async def put_skisser_ordning(gravplats_id: int, body: SkissOrdningBody, db: Session = Depends(get_db)):
    """Uppdatera ordning på skisser (drag and drop)."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    for i, skiss_id in enumerate(body.skiss_ids):
        row = db.query(GravplatsSkiss).filter(
            GravplatsSkiss.id == skiss_id,
            GravplatsSkiss.gravplats_id == gravplats_id,
        ).first()
        if row:
            row.sort_order = i
    db.commit()
    return {"ok": True}


@app.delete("/api/gravplats/{gravplats_id:int}/skisser/{skiss_id:int}")
async def delete_skiss(gravplats_id: int, skiss_id: int, db: Session = Depends(get_db)):
    """Ta bort en skiss (ändra inte – ta bort och gör om vid behov)."""
    row = db.query(GravplatsSkiss).filter(
        GravplatsSkiss.id == skiss_id,
        GravplatsSkiss.gravplats_id == gravplats_id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Skissen hittades inte")
    db.delete(row)
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
            {
                "id": em.id,
                "filnamn": em.filnamn,
                "typ": em.typ,
                "grav_start_sida": em.grav_start_sida,
                "redan_halva": getattr(em, "redan_halva", False),
                "kommentar": getattr(em, "kommentar", None) or "",
            }
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
            {
                "id": em.id,
                "filnamn": em.filnamn,
                "typ": em.typ,
                "redan_halva": getattr(em, "redan_halva", False),
                "kommentar": getattr(em, "kommentar", None) or "",
            }
            for em in items
        ],
    }


@app.get("/api/mappar/{mapp_namn}/fil/{filnamn}/bild")
async def pdf_fil_sida_bild(mapp_namn: str, filnamn: str):
    """Returnera första sidan av en PDF-fil som PNG (hela sidan). Används t.ex. för 'redan halva'-extramaterial."""
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
    doc = fitz.open(path)
    try:
        page = doc[0]
        pix = page.get_pixmap(dpi=150)
        png_bytes = pix.tobytes("png")
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    finally:
        doc.close()


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
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{path.name}"'},
    )


@app.post("/api/mappar/{mapp_namn}/extramaterial")
async def add_extramaterial(
    mapp_namn: str,
    body: ExtramaterialSchema,
    db: Session = Depends(get_db),
):
    """Registrera en PDF som extramaterial. grav_start_sida=null = endast knutet till mappen.
    Justerar grav_start_sida för övriga extramaterial så att de fortfarande pekar på rätt grav."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    filnamn = body.filnamn.strip()
    excluded_före = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded_före = _expanded_effective_list(mapp_namn, excluded_före, db)
    p_sida = _content_page_1based_in_expanded(filnamn, expanded_före)

    em = Extramaterial(
        mapp_id=mapp_config.id,
        filnamn=filnamn,
        typ=body.typ.strip() or None if body.typ else None,
        grav_start_sida=body.grav_start_sida,
        redan_halva=getattr(body, "redan_halva", False),
    )
    db.add(em)
    db.flush()
    if p_sida is not None:
        _shift_grav_start_efter_tillagg(db, mapp_config.id, p_sida)
    db.commit()
    db.refresh(em)
    return {
        "id": em.id,
        "filnamn": em.filnamn,
        "typ": em.typ,
        "grav_start_sida": em.grav_start_sida,
        "redan_halva": getattr(em, "redan_halva", False),
    }


@app.patch("/api/mappar/{mapp_namn}/extramaterial/{em_id}")
async def patch_extramaterial(
    mapp_namn: str,
    em_id: int,
    body: ExtramaterialPatchSchema,
    db: Session = Depends(get_db),
):
    """Uppdatera extramaterial (t.ex. redan_halva, dold)."""
    _mapp_path(mapp_namn)
    em = db.query(Extramaterial).filter(Extramaterial.id == em_id).first()
    if not em:
        raise HTTPException(status_code=404, detail="Extramaterial hittades inte")
    if body.redan_halva is not None:
        em.redan_halva = body.redan_halva
    if body.dold is not None:
        em.dold = body.dold
    if body.kommentar is not None:
        em.kommentar = body.kommentar
    db.commit()
    db.refresh(em)
    return {
        "id": em.id,
        "filnamn": em.filnamn,
        "typ": em.typ,
        "grav_start_sida": em.grav_start_sida,
        "redan_halva": getattr(em, "redan_halva", False),
        "dold": getattr(em, "dold", False),
        "kommentar": getattr(em, "kommentar", None) or "",
    }


@app.delete("/api/mappar/{mapp_namn}/extramaterial/{em_id}")
async def delete_extramaterial(
    mapp_namn: str,
    em_id: int,
    db: Session = Depends(get_db),
):
    """Ta bort ett extramaterial (via id). Justerar grav_start_sida för övriga så att de pekar kvar på rätt grav."""
    _mapp_path(mapp_namn)
    em = db.query(Extramaterial).filter(Extramaterial.id == em_id).first()
    if not em:
        raise HTTPException(status_code=404, detail="Extramaterial hittades inte")
    mapp_config_id = em.mapp_id
    filnamn = em.filnamn
    excluded_med = _excluded_filenames_for_mapp(db, mapp_namn)
    excluded_utan_denna = excluded_med - {filnamn}
    expanded_efter = _expanded_effective_list(mapp_namn, excluded_utan_denna, db)
    p_sida = _content_page_1based_in_expanded(filnamn, expanded_efter)

    db.delete(em)
    if p_sida is not None:
        _shift_grav_start_efter_borttag(db, mapp_config_id, p_sida)
    db.commit()
    return {"ok": True}


@app.delete("/api/mappar/{mapp_namn}/extramaterial-by-ref")
async def delete_extramaterial_by_ref(
    mapp_namn: str,
    filnamn: str,
    grav_start_sida: int | None = None,
    db: Session = Depends(get_db),
):
    """Ta bort ett extramaterial via filnamn och (valfritt) grav_start_sida. grav_start_sida=null = mapp-nivå.
    Justerar grav_start_sida för övriga extramaterial."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        raise HTTPException(status_code=404, detail="Mappen hittades inte")
    q = db.query(Extramaterial).filter(
        Extramaterial.mapp_id == mapp_config.id,
        Extramaterial.filnamn == filnamn.strip(),
    )
    if grav_start_sida is not None:
        q = q.filter(Extramaterial.grav_start_sida == grav_start_sida)
    else:
        q = q.filter(Extramaterial.grav_start_sida.is_(None))
    em = q.first()
    if not em:
        raise HTTPException(status_code=404, detail="Extramaterial hittades inte")
    filnamn_ = em.filnamn
    excluded_med = _excluded_filenames_for_mapp(db, mapp_namn)
    excluded_utan_denna = excluded_med - {filnamn_}
    expanded_efter = _expanded_effective_list(mapp_namn, excluded_utan_denna, db)
    p_sida = _content_page_1based_in_expanded(filnamn_, expanded_efter)

    db.delete(em)
    if p_sida is not None:
        _shift_grav_start_efter_borttag(db, mapp_config.id, p_sida)
    db.commit()
    return {"ok": True}


class SidaRedanHalvaSchema(BaseModel):
    filnamn: str
    redan_halva: bool  # True = visa sidan som en halva i flödet (hela sidan = en bild), ordningen behålls


@app.post("/api/mappar/{mapp_namn}/sida-redan-halva")
async def set_sida_redan_halva(
    mapp_namn: str,
    body: SidaRedanHalvaSchema,
    db: Session = Depends(get_db),
):
    """Markera eller avmarkera en sida (fil) i flödet som 'redan halva'. Sidan stannar kvar i flödet och visas som en bild."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    filnamn = body.filnamn.strip()
    if "/" in filnamn or "\\" in filnamn or ".." in filnamn:
        raise HTTPException(status_code=400, detail="Ogiltigt filnamn")
    existing = (
        db.query(MappSidaRedanHalva)
        .filter(MappSidaRedanHalva.mapp_id == mapp_config.id, MappSidaRedanHalva.filnamn == filnamn)
        .first()
    )
    if body.redan_halva:
        if not existing:
            db.add(MappSidaRedanHalva(mapp_id=mapp_config.id, filnamn=filnamn))
    else:
        if existing:
            db.delete(existing)
    db.commit()
    return {"ok": True, "filnamn": filnamn, "redan_halva": body.redan_halva}


# ---------- Infogade tomma sidor och filordning ----------


class InfogaTomSidaSchema(BaseModel):
    efter_filnamn: str  # PDF-filnamn efter vilken tom sidan infogas


@app.post("/api/mappar/{mapp_namn}/infoga-tom-sida")
async def infoga_tom_sida(
    mapp_namn: str,
    body: InfogaTomSidaSchema,
    db: Session = Depends(get_db),
):
    """Infoga en tom sida efter angiven PDF. Justerar grav_start_sida för extramaterial efter infogningen."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    efter = body.efter_filnamn.strip()
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    p_sida = _content_page_1based_in_expanded(efter, expanded)
    if p_sida is None:
        raise HTTPException(status_code=400, detail="Filnamnet finns inte i innehållslistan")
    row = InfogadTomSida(mapp_id=mapp_config.id, efter_filnamn=efter)
    db.add(row)
    db.flush()
    _shift_grav_start_efter_tillagg(db, mapp_config.id, p_sida)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "efter_filnamn": efter}


@app.delete("/api/mappar/{mapp_namn}/infogad-tom-sida/{blank_id}")
async def ta_bort_infogad_tom_sida(
    mapp_namn: str,
    blank_id: int,
    db: Session = Depends(get_db),
):
    """Ta bort en infogad tom sida. Justerar grav_start_sida för extramaterial."""
    _mapp_path(mapp_namn)
    row = db.query(InfogadTomSida).filter(InfogadTomSida.id == blank_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Infogad tom sida hittades inte")
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config or row.mapp_id != mapp_config.id:
        raise HTTPException(status_code=404, detail="Infogad tom sida hittades inte i denna mapp")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    p_sida = None
    for i, item in enumerate(expanded):
        if item.get("t") == "b" and item.get("id") == blank_id:
            p_sida = i + 1
            break
    if p_sida is None:
        raise HTTPException(status_code=404, detail="Infogad tom sida finns inte i listan")
    db.delete(row)
    _shift_grav_start_efter_borttag(db, mapp_config.id, p_sida)
    db.commit()
    return {"ok": True}


class FlyttaSidaSchema(BaseModel):
    filnamn: str
    riktning: str  # "vänster" | "höger" (eller "framåt" | "bakåt" för bakåtkompatibilitet)


@app.post("/api/mappar/{mapp_namn}/flytta-sida")
async def flytta_sida(
    mapp_namn: str,
    body: FlyttaSidaSchema,
    db: Session = Depends(get_db),
):
    """Flytta en sida vänster eller höger i ordningen. Klienten laddar om fillistan efter anrop."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    filnamn = body.filnamn.strip()
    riktning = body.riktning.strip().lower()
    if riktning in ("vänster", "vanster", "framåt", "framat"):
        riktning = "vänster"
    elif riktning in ("höger", "hoger", "bakåt", "bakat"):
        riktning = "höger"
    else:
        raise HTTPException(status_code=400, detail="riktning måste vara vänster eller höger")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    base_names = [n for n in _ordered_pdf_names(mapp_namn, db) if n not in excluded]
    try:
        idx = base_names.index(filnamn)
    except ValueError:
        raise HTTPException(status_code=404, detail="Filen finns inte i listan")
    if riktning == "vänster":
        if idx == 0:
            raise HTTPException(status_code=400, detail="Sidan är redan längst vänster")
        swap_idx = idx - 1
    else:
        if idx >= len(base_names) - 1:
            raise HTTPException(status_code=400, detail="Sidan är redan längst höger")
        swap_idx = idx + 1
    other = base_names[swap_idx]
    full_ordered = _ordered_pdf_names(mapp_namn, db)
    try:
        i_a = full_ordered.index(filnamn)
        i_b = full_ordered.index(other)
    except ValueError:
        raise HTTPException(status_code=404, detail="Filen finns inte i mappen")
    full_ordered[i_a], full_ordered[i_b] = full_ordered[i_b], full_ordered[i_a]
    for pos, name in enumerate(full_ordered):
        existing = db.query(MappFilOrdning).filter(
            MappFilOrdning.mapp_id == mapp_config.id,
            MappFilOrdning.filnamn == name,
        ).first()
        if existing:
            existing.position = pos
        else:
            db.add(MappFilOrdning(mapp_id=mapp_config.id, filnamn=name, position=pos))
    db.commit()
    return {"ok": True, "message": "Ordning uppdaterad – nolla cachning i gränssnittet."}


# ---------- Dev (stäng av servern vid behov) ----------


def _do_shutdown():
    """Avsluta servern. Körs i bakgrund så att klienten kan få svar först."""
    import time
    time.sleep(0.3)
    try:
        parent_pid = os.getppid()
        if sys.platform == "win32":
            import subprocess
            subprocess.run(["taskkill", "/F", "/PID", str(parent_pid)], capture_output=True)
        else:
            os.kill(parent_pid, signal.SIGTERM)
    except Exception:
        pass
    os._exit(0)


@app.post("/api/dev/shutdown")
async def dev_shutdown():
    """Stänger av appen (uvicorn). Används från dev-menyn. Vid --reload dödas parent så att hela servern avslutas."""
    threading.Thread(target=_do_shutdown, daemon=True).start()
    return {"ok": True, "message": "Servern stängs av..."}


# Statiska filer (CSS, JS) och eventuella genererade bilder
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
