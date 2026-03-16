"""Hjälpfunktioner för gravplats: halvor och inmatningsrespons."""
import base64
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from fastapi import HTTPException
from sqlalchemy.orm import Session

if TYPE_CHECKING:
    pass


def _gravplats_halvor(
    g,
    foregaende_grav=None,
    layout_typ: str = "standard_3_sidor",
) -> list[dict]:
    """
    Lista vilka delar (content_sida + segment_index / halva) som tillhör denna gravplats.
    layout_typ standard_3_sidor: sida 1 nedre (gravrätt), sida 2 nedre (gravsatta 1–5), sida 3 övre (gravsatta 6–10).
    1_sida_per_grav: en sida, en del (segment_index 0).
    2_gravar_per_sida: en sida, en del = g.segment_index.
    """
    segment_idx = getattr(g, "segment_index", 0) or 0
    if layout_typ == "1_sida_per_grav":
        return [{"content_sida": g.start_sida, "segment_index": 0, "halva": "nedre", "typ": "gravplats"}]
    if layout_typ == "2_gravar_per_sida":
        return [{
            "content_sida": g.start_sida,
            "segment_index": segment_idx,
            "halva": "ovre" if segment_idx == 0 else "nedre",
            "typ": "gravplats",
        }]
    # standard_3_sidor
    s1, s2, s3 = g.start_sida, g.start_sida + 1, g.start_sida + 2
    halvor = [
        {"content_sida": s1, "segment_index": 1, "halva": "nedre", "typ": "gravrätt", "position": 1},
        {"content_sida": s2, "segment_index": 1, "halva": "nedre", "typ": "gravsatta_1_5", "position": 2},
    ]
    if getattr(g, "sida1_ovre_tillhor_denna", False):
        halvor.append({"content_sida": s1, "segment_index": 0, "halva": "ovre", "typ": "gravrätt_ovre", "position": 1})
    if not getattr(g, "sida3_ovre_tillhor_nasta", False):
        halvor.append({"content_sida": s3, "segment_index": 0, "halva": "ovre", "typ": "gravsatta_6_10", "position": 3})
    if foregaende_grav and getattr(foregaende_grav, "sida3_ovre_tillhor_nasta", False):
        halvor.append({"content_sida": s1, "segment_index": 0, "halva": "ovre", "typ": "gravsatta_6_10_fran_foregaende_sida", "position": 1})
    return halvor


def _inmatning_response(gravplats_id: int, db: Session) -> dict:
    """Bygg svar för GET inmatning."""
    from app.database import (
        GravplatsInmatning, GravplatsInnehavare, GravplatsNarmastAnhorig,
        Gravsatt, GravplatsSkiss, User,
    )
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
        innehavare_list = [{"fornamn": fn, "efternamn": en, "yrke": row.yrke or "", "gatuadress": row.adress or "", "postnummer": "", "postort": "", "kommentar": "", "sort_order": 0}]
    else:
        innehavare_list = [
            {"fornamn": _inv_fornamn_efternamn(n)[0], "efternamn": _inv_fornamn_efternamn(n)[1], "yrke": n.yrke or "", "gatuadress": getattr(n, "gatuadress", None) or n.adress or "", "postnummer": getattr(n, "postnummer", None) or "", "postort": getattr(n, "postort", None) or "", "kommentar": getattr(n, "kommentar", None) or "", "sort_order": n.sort_order}
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
            "gatuadress": getattr(g, "gatuadress", None) or g.adress or "",
            "postnummer": getattr(g, "postnummer", None) or "",
            "postort": getattr(g, "postort", None) or "",
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
            "segment_index": getattr(s, "segment_index", None),
            "extramaterial_id": s.extramaterial_id,
            "x": s.x,
            "y": s.y,
            "width": s.width,
            "height": s.height,
            "sort_order": s.sort_order,
        }
        for s in skisser_rows
    ]
    narmast_list = [{"id": n.id, "fornamn": _inv_fornamn_efternamn(n)[0], "efternamn": _inv_fornamn_efternamn(n)[1], "yrke": getattr(n, "yrke", None) or "", "adress": n.adress or "", "postnummer": n.postnummer or "", "postort": n.postort or "", "telefon": n.telefon or "", "kommentar": getattr(n, "kommentar", None) or "", "sort_order": n.sort_order} for n in narmast]
    if not row:
        return {
            "gravplats_id": gravplats_id,
            "innehavare": innehavare_list,
            "narmast_anhoriga": narmast_list,
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
            "version": 0,
            "last_edited_at": None,
            "last_edited_by_username": None,
        }
    last_editor = db.query(User).filter(User.id == row.last_edited_by_user_id).first() if getattr(row, "last_edited_by_user_id", None) else None
    return {
        "gravplats_id": gravplats_id,
        "innehavare": innehavare_list,
        "narmast_anhoriga": narmast_list,
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
        "version": getattr(row, "version", 0),
        "last_edited_at": getattr(row, "last_edited_at", None),
        "last_edited_by_username": last_editor.username if last_editor else None,
    }
