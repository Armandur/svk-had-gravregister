"""Förslag på skissmarkering: bildmätningen och routen."""
import fitz
import pytest

from app.database import Gravplats, GravplatsSkiss, MappConfig
from app.utils import skissforslag as sf

W, H = 1650, 1000


def _kort(vanster_kant=0.172, text_vanster=True, text_mitten=False):
    """Syntetisk halva med kortets tre förtryckta rutor, i samma koordinater som de riktiga."""
    doc = fitz.open()
    p = doc.new_page(width=W, height=H)
    rect = lambda x0, y0, x1, y1: fitz.Rect(x0 * W, y0 * H, x1 * W, y1 * H)
    p.draw_rect(rect(0.058, 0.38, vanster_kant, 0.54), color=(0, 0, 0), width=3)
    p.draw_rect(rect(0.466, 0.38, 0.522, 0.54), color=(0, 0, 0), width=3)
    p.draw_rect(rect(0.86, 0.42, 0.91, 0.49), color=(0, 0, 0), width=2)
    if text_vanster:
        p.insert_text(fitz.Point(0.09 * W, 0.47 * H), "1.  2.", fontsize=36)
    if text_mitten:
        p.insert_text(fitz.Point(0.48 * W, 0.47 * H), "1.", fontsize=36)
    return p.get_pixmap().tobytes("png")


def test_vanster_ruta_med_standardbredd():
    f = sf.foresla(_kort())
    assert (f["ruta"], f["sakerhet"]) == ("vanster", "skiss")
    assert f["x"] + f["width"] == pytest.approx(0.176, abs=0.01)


def test_forlangd_ruta_far_uppmatt_hogerkant():
    """Som HKN E 25+26: rutan förlängd för hand till dubbel bredd."""
    f = sf.foresla(_kort(vanster_kant=0.265))
    assert f["x"] + f["width"] == pytest.approx(0.269, abs=0.01)


def test_mittrutan_och_tomt_kort():
    assert sf.foresla(_kort(text_vanster=False, text_mitten=True))["ruta"] == "mitten"
    assert sf.foresla(_kort(text_vanster=False)) is None


@pytest.fixture
def grav(db):
    m = db.query(MappConfig).filter(MappConfig.namn == "skissmapp").first() or MappConfig(namn="skissmapp", kyrkogard="SKS")
    db.add(m)
    db.flush()
    sida = (db.query(Gravplats.start_sida).filter(Gravplats.mapp_id == m.id).order_by(Gravplats.start_sida.desc()).limit(1).scalar() or 0) + 3
    g = Gravplats(mapp_id=m.id, kvarter="S", gravplatsnummer=str(sida), start_sida=sida, kyrkogard="SKS")
    db.add(g)
    db.commit()
    return g.id


def test_route_foreslar_bara_for_grav_utan_skiss(grav, logga_in, db, monkeypatch):
    monkeypatch.setattr(sf, "rendera_halva", lambda db, g, sida, seg: _kort())
    c = logga_in("skissare")
    f = c.get(f"/api/gravplats/{grav}/skissforslag").json()["forslag"]
    assert (f["ruta"], f["source_type"], f["halva"], f["segment_index"]) == ("vanster", "halva", "nedre", 1)
    # Förslaget går att spara som det är, via den vanliga skissrouten
    r = c.post(f"/api/gravplats/{grav}/skisser", json={k: f[k] for k in ("source_type", "content_sida", "halva", "segment_index", "x", "y", "width", "height")})
    assert r.status_code == 200
    assert db.query(GravplatsSkiss).filter(GravplatsSkiss.gravplats_id == grav).count() == 1
    assert c.get(f"/api/gravplats/{grav}/skissforslag").json()["forslag"] is None
