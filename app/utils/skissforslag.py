"""Förslag på skissmarkering genom bildmätning (TASK-3286).

Kortet har tre förtryckta rutor för skissen. Granskarna markerar den som är
ifylld: vänstra kvadraten (oftast, ibland förlängd för hand vid dubbelgravar)
eller mittrutan. Den prickade högra rutan har aldrig markerats.

Mätning 2026-11-05 på prods 254 skisser:
- Valet av ruta efter bläck: 33 av 33 rätt i ett testurval. Bläck hittar
  249 av 253 skisser, och de flesta "falsklarm" var skisser som saknade markering.
- Högerkanten (den lodräta linje längst till höger som täcker rutans höjd):
  239 av 242 inom 0,02. Resten var anteckningar som granskaren drog ut
  markeringen för att ta med.
- Vision-modellerna var sämre: qwen3-vl hittade 56 av 253 skisser.

Alla koordinater är andelar av halvans bredd och höjd, som i gravplats_skiss.
"""
import fitz
from sqlalchemy.orm import Session

from app.database import Gravplats, GravplatsSkiss, MappConfig
from app.utils.gravplats_utils import _gravplats_halvor
from app.utils.pdf_utils import (
    _clip_rect_for_segment, _content_page_to_item, _excluded_filenames_for_mapp, _mapp_config_andelar,
    _redan_halva_filenames_for_mapp,
)

# Skisserna sitter på kortets första sida, nedre halvan (alla 253 i prod)
SEGMENT = 1
HALVA = "nedre"

# Mätområden inuti rutorna, innanför ramarna och förbi hålslaget
_VANSTER_INRE = (0.065, 0.385, 0.165, 0.525)
_MITTEN_INRE = (0.475, 0.385, 0.515, 0.525)
_BLACK = 110          # gråvärde under detta räknas som bläck
_MITTEN_SKISS = 0.002  # omarkerade mittrutor ligger på 0,0000
_VANSTER_SKISS = 0.002
_VANSTER_KANSKE = 0.001

# Granskarnas mediankoordinater för markeringen per ruta
_VANSTER = {"x": 0.050, "y": 0.372, "hojd": 0.175}
_MITTEN = {"x": 0.462, "y": 0.370, "bredd": 0.069, "hojd": 0.181}
_VANSTER_STANDARDKANT = 0.172


def rendera_halva(db: Session, g: Gravplats, content_sida: int, segment_index: int) -> bytes | None:
    """Halvan som gravvyn visar för (sida, segment), som PNG i 200 dpi. None om sidan saknas."""
    m = db.get(MappConfig, g.mapp_id)
    layout = m.layout_typ or "standard_3_sidor"
    fore = db.query(Gravplats).filter(Gravplats.mapp_id == g.mapp_id, Gravplats.start_sida == g.start_sida - 2).first() \
        if layout == "standard_3_sidor" else None
    halvor = _gravplats_halvor(g, fore, layout_typ=layout)
    h = next((x for x in halvor if x.get("content_sida") == content_sida and x.get("segment_index", 0) == segment_index), {})
    excluded = _excluded_filenames_for_mapp(db, m.namn)
    item = _content_page_to_item(m.namn, excluded, content_sida, db)
    if item is None or item[0] != "file":
        return None
    sokvag = item[1]
    dela = m.dela_sidor or "hojdled"
    with fitz.open(sokvag) as doc:
        page = doc[0]
        if sokvag.name in _redan_halva_filenames_for_mapp(db, m.id) or dela == "ingen":
            return page.get_pixmap(dpi=200).tobytes("png")
        andelar = _mapp_config_andelar(m, position=h.get("position"))
        clip = _clip_rect_for_segment(page.rect, segment_index, andelar, dela)
        return page.get_pixmap(dpi=200, clip=clip).tobytes("png")


def foresla(png: bytes) -> dict | None:
    """Förslag på markering i halvans koordinater, eller None om ingen ruta har bläck.

    säkerhet "skiss" när bläcket är tydligt, "kanske" när det är svagt och bör granskas.
    """
    pix = fitz.Pixmap(fitz.csGRAY, fitz.Pixmap(png))
    W, H, s, st = pix.width, pix.height, pix.samples, pix.stride

    def blackandel(x0, y0, x1, y1):
        mork = totalt = 0
        for y in range(int(y0 * H), int(y1 * H), 2):
            rad = y * st
            for x in range(int(x0 * W), int(x1 * W), 2):
                totalt += 1
                mork += s[rad + x] < _BLACK
        return mork / totalt if totalt else 0.0

    mitten = blackandel(*_MITTEN_INRE)
    vanster = blackandel(*_VANSTER_INRE)
    if mitten > _MITTEN_SKISS and mitten >= vanster:
        return {"ruta": "mitten", "sakerhet": "skiss", "blackandel": round(mitten, 4),
                "x": _MITTEN["x"], "y": _MITTEN["y"], "width": _MITTEN["bredd"], "height": _MITTEN["hojd"]}
    if vanster <= _VANSTER_KANSKE:
        return None

    # Högerkant: lodrät linje längst till höger som täcker över 85 % av rutans höjd
    y0, y1 = int(0.40 * H), int(0.52 * H)
    kant = _VANSTER_STANDARDKANT
    for x in range(int(0.44 * W), int(0.10 * W), -1):
        tackt = sum(1 for y in range(y0, y1) if min(s[y * st + xx] for xx in (x - 1, x, x + 1)) < 128)
        if tackt / (y1 - y0) > 0.85:
            kant = x / W
            break
    return {"ruta": "vanster", "sakerhet": "skiss" if vanster > _VANSTER_SKISS else "kanske",
            "blackandel": round(vanster, 4), "x": _VANSTER["x"], "y": _VANSTER["y"],
            "width": round(kant + 0.004 - _VANSTER["x"], 3), "height": _VANSTER["hojd"]}


def skissforslag(db: Session, gravplats_id: int) -> dict | None:
    """Förslag för en grav som saknar skiss, med var på kortet det gäller. None om inget förslag."""
    g = db.get(Gravplats, gravplats_id)
    if g is None or db.query(GravplatsSkiss.id).filter(GravplatsSkiss.gravplats_id == gravplats_id).first():
        return None
    m = db.get(MappConfig, g.mapp_id)
    if (m.layout_typ or "standard_3_sidor") != "standard_3_sidor":
        return None
    png = rendera_halva(db, g, g.start_sida, SEGMENT)
    if png is None:
        return None
    forslag = foresla(png)
    if forslag is None:
        return None
    return {**forslag, "source_type": "halva", "content_sida": g.start_sida, "halva": HALVA, "segment_index": SEGMENT}
