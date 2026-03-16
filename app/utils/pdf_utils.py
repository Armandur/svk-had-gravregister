"""PDF-bearbetningshjälpfunktioner: sidrendering, klippning, tomma sidor, mapphantering."""
import json
from pathlib import Path
from typing import TYPE_CHECKING

import fitz  # PyMuPDF
from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import KÄLLDATA_DIR

if TYPE_CHECKING:
    pass


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


def _segment_bounds(andelar: list[float], segment_index: int) -> tuple[float, float]:
    """Returnera (start, end) andel 0–1 för segment_index. andelar = gränser t.ex. [0.455] -> segment 0: 0–0.455, 1: 0.455–1."""
    bounds = [0.0] + [float(x) for x in andelar] + [1.0]
    bounds = sorted(set(bounds))
    i = max(0, min(segment_index, len(bounds) - 2))
    return bounds[i], bounds[i + 1]


def _clip_rect_for_segment(
    page_rect: fitz.Rect,
    segment_index: int,
    andelar: list[float],
    dela_sidor: str,
) -> fitz.Rect | None:
    """Rektangel för segment (0, 1, …). dela_sidor: hojdled = vertikal, breddled = horisontell. None = hela sidan."""
    if dela_sidor == "ingen" or not andelar or segment_index < 0:
        return None
    start, end = _segment_bounds(andelar, segment_index)
    r = page_rect
    if dela_sidor == "breddled":
        return fitz.Rect(r.width * start, 0, r.width * end, r.height)
    else:
        return fitz.Rect(0, r.height * start, r.width, r.height * end)


def _mapp_config_andelar(row, position: int | None = None) -> list[float]:
    """Returnera andelar från mapp_config. position 1,2,3 = position i block (standard_3_sidor).
    Om position anges och andelar_per_position finns används den; annars andelar; annars klassiska default (727/1597, 870/1595)."""
    CLASSIC_1_3 = [727 / 1597]
    CLASSIC_2 = [870 / 1595]
    if not row:
        if position == 2:
            return CLASSIC_2
        if position in (1, 3):
            return CLASSIC_1_3
        return [0.5]
    layout = getattr(row, "layout_typ", None) or "standard_3_sidor"
    if position is not None and position in (1, 2, 3):
        per_pos = getattr(row, "andelar_per_position", None)
        if per_pos:
            try:
                d = json.loads(per_pos) if isinstance(per_pos, str) else per_pos
                if isinstance(d, dict) and str(position) in d:
                    a = d[str(position)]
                    if isinstance(a, list) and len(a) >= 1:
                        return [float(x) for x in a]
            except (TypeError, ValueError):
                pass
        if layout == "standard_3_sidor":
            return CLASSIC_2 if position == 2 else CLASSIC_1_3
    if getattr(row, "andelar", None):
        try:
            a = json.loads(row.andelar) if isinstance(row.andelar, str) else row.andelar
            return a if isinstance(a, list) and len(a) >= 1 else [0.5]
        except (TypeError, ValueError):
            pass
    if layout == "standard_3_sidor" and position in (1, 2, 3):
        return CLASSIC_2 if position == 2 else CLASSIC_1_3
    return [0.5]


def _mapp_config_andelar_per_position(row) -> dict[str, list[float]] | None:
    """Returnera andelar_per_position som dict eller None."""
    if not row:
        return None
    per_pos = getattr(row, "andelar_per_position", None)
    if not per_pos:
        return None
    try:
        d = json.loads(per_pos) if isinstance(per_pos, str) else per_pos
        if isinstance(d, dict):
            return {k: [float(x) for x in v] for k, v in d.items() if isinstance(v, list) and v}
    except (TypeError, ValueError):
        pass
    return None


# ── Databasberoende hjälpfunktioner ──────────────────────────────────────────

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
    from app.database import MappConfig, MappFilOrdning
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
    from app.database import MappConfig, InfogadTomSida
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


def _content_page_1based(filnamn: str, effective_names: list[str]) -> int | None:
    """1-baserat innehållssidanummer för filnamn i listan, eller None om inte med."""
    try:
        i = effective_names.index(filnamn)
        return i + 1
    except ValueError:
        return None


def _excluded_filenames_for_mapp(db: Session, mapp_namn: str) -> set[str]:
    """Set med filnamn som är extramaterial i denna mapp."""
    from app.database import MappConfig, Extramaterial
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return set()
    return {em.filnamn for em in db.query(Extramaterial).filter(Extramaterial.mapp_id == mapp_config.id).all()}


def _redan_halva_filenames_for_mapp(db: Session, mapp_config_id: int | None) -> set[str]:
    """Set med filnamn som är markerade som 'redan halva' i flödet."""
    from app.database import MappSidaRedanHalva
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


def _shift_grav_start_efter_tillagg(db: Session, mapp_config_id: int, efter_sida: int) -> None:
    """Minska grav_start_sida med 1 för alla extramaterial i mappen som har grav_start_sida > efter_sida."""
    from app.database import Extramaterial
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
    from app.database import Extramaterial
    db.execute(
        update(Extramaterial)
        .where(
            Extramaterial.mapp_id == mapp_config_id,
            Extramaterial.grav_start_sida.isnot(None),
            Extramaterial.grav_start_sida >= fran_och_med_sida,
        )
        .values(grav_start_sida=Extramaterial.grav_start_sida + 1)
    )
