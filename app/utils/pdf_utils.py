"""PDF-bearbetningshjälpfunktioner: sidrendering, klippning, tomma sidor."""
import json
from pathlib import Path

import fitz  # PyMuPDF

from app.config import KÄLLDATA_DIR
from fastapi import HTTPException


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
    # Klassiska default för standard 3-sidors layout (sida 1 och 3: 727/1597, sida 2: 870/1595)
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
