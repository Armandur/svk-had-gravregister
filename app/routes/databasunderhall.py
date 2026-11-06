"""Databasunderhåll: generella fältkontroller, saknade postnummer, skisser och användares registreringar."""
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import (
    Gravplats,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    GravplatsRedigeringslogg,
    GravplatsSkiss,
    Gravsatt,
    MappConfig,
    User,
    get_db,
)
from app.utils.datakvalitet import (
    _dbuh_falt_alla_config,
    _dbuh_format_fullstandigt,
    _dbuh_gravplats_lista,
    _dbuh_iter_falt,
    _dbuh_last_edited_map,
    _dbuh_matchar_siffror_komma,
    _dbuh_parse_falt,
)
from app.utils.text import _format_fullstandigt

router = APIRouter()


@router.get("/api/admin/databasunderhall/gravplatser-saknar-postnummer-ort")
async def get_gravplatser_saknar_postnummer_ort(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Lista gravplatser där minst en innehavare, gravsatt eller närmast anhörig har gatuadress
    men saknar postnummer och/eller postort.
    """
    def _post_tom(s):
        return s is None or (isinstance(s, str) and s.strip() == "")

    def _har_adress_saknar_post(r, gatuadress_attr="gatuadress"):
        gata = getattr(r, gatuadress_attr, None) or ""
        if not gata or not str(gata).strip():
            return False
        return _post_tom(getattr(r, "postnummer", None)) or _post_tom(getattr(r, "postort", None))

    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}

    for r in db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id.isnot(None)).all():
        if _har_adress_saknar_post(r):
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).append({
                "roll": "Innehavare",
                "gatuadress": (r.gatuadress or "").strip(),
                "postnummer": (r.postnummer or "").strip(),
                "postort": (r.postort or "").strip(),
            })

    for r in db.query(Gravsatt).filter(Gravsatt.gravplats_id.isnot(None)).all():
        if _har_adress_saknar_post(r):
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).append({
                "roll": "Gravsatt",
                "gatuadress": (r.gatuadress or "").strip(),
                "postnummer": (r.postnummer or "").strip(),
                "postort": (r.postort or "").strip(),
            })

    for r in db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id.isnot(None)).all():
        if _har_adress_saknar_post(r, "adress"):
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).append({
                "roll": "Närmast anhörig",
                "gatuadress": (r.adress or "").strip(),
                "postnummer": (r.postnummer or "").strip(),
                "postort": (r.postort or "").strip(),
            })

    if not all_ids:
        return {"gravplatser": [], "antal": 0}

    last_edited_map = _dbuh_last_edited_map(db, list(all_ids))
    extra = {}
    for gid in all_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_rader": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(all_ids), extra)
    return {"gravplatser": out, "antal": len(out)}


@router.get("/api/admin/databasunderhall/falt-alla")
async def get_databasunderhall_falt_alla(admin: User = Depends(require_admin)):
    """Lista tillgängliga tabeller och fält för generella fältkontroller."""
    return {"tabeller": _dbuh_falt_alla_config()}


@router.get("/api/admin/databasunderhall/datakvalitet-generell-tecken")
async def get_datakvalitet_generell_tecken(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    falt: str = "",
    tecken: str = "",
    regex: str = "",
):
    """
    Sök efter tecken eller regex-mönster i valda fält.
    falt = table:field,table:field (t.ex. innehavare:postnummer,gravsatt:postort).
    Ange antingen tecken (t.ex. =£$%& eller Ol) eller regex.
    """
    falt_list = _dbuh_parse_falt(falt)
    if not falt_list:
        return {"gravplatser": [], "antal": 0}
    use_regex = bool(regex and regex.strip())
    if not use_regex and not (tecken and tecken.strip()):
        return {"gravplatser": [], "antal": 0}
    pattern = re.compile(regex) if use_regex else re.compile("[" + re.escape(tecken.strip()) + "]")
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for gid, roll, field_key, field_label, val in _dbuh_iter_falt(db, falt_list):
        if not val:
            continue
        if pattern.search(val):
            all_ids.add(gid)
            problem_per_gp.setdefault(gid, []).append({
                "roll": roll, "falt": field_label, "varde": (val[:200] + "…") if len(val) > 200 else val,
            })
    extra = {}
    last_edited_map = _dbuh_last_edited_map(db, list(all_ids))
    for gid in all_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_falt": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(all_ids), extra)
    return {"gravplatser": out, "antal": len(out)}


@router.get("/api/admin/databasunderhall/datakvalitet-generell-siffror-komma")
async def get_datakvalitet_generell_siffror_komma(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    falt: str = "",
    typ: str = "bada",
):
    """Sök siffror och/eller kommatecken i valda fält. typ = bada | siffror | komma."""
    if typ not in ("bada", "siffror", "komma"):
        typ = "bada"
    falt_list = _dbuh_parse_falt(falt)
    if not falt_list:
        return {"gravplatser": [], "antal": 0}
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for gid, roll, field_key, field_label, val in _dbuh_iter_falt(db, falt_list):
        if _dbuh_matchar_siffror_komma(val, typ):
            all_ids.add(gid)
            problem_per_gp.setdefault(gid, []).append({"roll": roll, "falt": field_label, "varde": (val[:200] + "…") if len(val) > 200 else val})
    extra = {}
    last_edited_map = _dbuh_last_edited_map(db, list(all_ids))
    for gid in all_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_falt": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(all_ids), extra)
    return {"gravplatser": out, "antal": len(out)}


@router.get("/api/admin/databasunderhall/datakvalitet-generell-langd")
async def get_datakvalitet_generell_langd(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    falt: str = "",
    min_punkter: int | None = None,
    max_tecken: int | None = None,
):
    """Fält med minst N punkter och/eller längre än N tecken."""
    falt_list = _dbuh_parse_falt(falt)
    if not falt_list:
        return {"gravplatser": [], "antal": 0}
    use_punkter = min_punkter is not None and min_punkter >= 1
    use_tecken = max_tecken is not None and max_tecken >= 1
    if not use_punkter and not use_tecken:
        return {"gravplatser": [], "antal": 0}
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for gid, roll, field_key, field_label, val in _dbuh_iter_falt(db, falt_list):
        if not val:
            continue
        problems = []
        if use_punkter and val.count(".") >= min_punkter:
            problems.append(field_label + ": " + str(val.count(".")) + " punkter")
        if use_tecken and len(val) > max_tecken:
            problems.append(field_label + ": " + str(len(val)) + " tecken")
        if problems:
            all_ids.add(gid)
            problem_per_gp.setdefault(gid, []).append({
                "roll": roll, "falt": "Längd/punkter", "varde": "; ".join(problems) + " – " + ((val[:80] + "…") if len(val) > 80 else val),
            })
    extra = {}
    last_edited_map = _dbuh_last_edited_map(db, list(all_ids))
    for gid in all_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_falt": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(all_ids), extra)
    return {"gravplatser": out, "antal": len(out)}


@router.get("/api/admin/databasunderhall/datakvalitet-generell-mellanslag")
async def get_datakvalitet_generell_mellanslag(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    falt: str = "",
):
    """Fält med inledande/avslutande mellanslag eller dubbelmellanslag."""
    falt_list = _dbuh_parse_falt(falt)
    if not falt_list:
        return {"gravplatser": [], "antal": 0}
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for gid, roll, field_key, field_label, val in _dbuh_iter_falt(db, falt_list):
        if not val or not isinstance(val, str):
            continue
        issues = []
        if val != val.strip():
            issues.append("inledande/avslutande mellanslag")
        if "  " in val:
            issues.append("dubbelmellanslag")
        if issues:
            all_ids.add(gid)
            problem_per_gp.setdefault(gid, []).append({
                "roll": roll, "falt": field_label, "varde": ", ".join(issues) + " – " + repr(val[:100]),
            })
    extra = {}
    last_edited_map = _dbuh_last_edited_map(db, list(all_ids))
    for gid in all_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_falt": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(all_ids), extra)
    return {"gravplatser": out, "antal": len(out)}


@router.get("/api/admin/databasunderhall/datakvalitet-generell-endast-siffror")
async def get_datakvalitet_generell_endast_siffror(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    falt: str = "",
):
    """Fält som endast innehåller siffror (och ev. mellanslag)."""
    falt_list = _dbuh_parse_falt(falt)
    if not falt_list:
        return {"gravplatser": [], "antal": 0}
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for gid, roll, field_key, field_label, val in _dbuh_iter_falt(db, falt_list):
        t = (val or "").strip()
        if t and t.replace(" ", "").isdigit():
            all_ids.add(gid)
            problem_per_gp.setdefault(gid, []).append({
                "roll": roll, "falt": field_label, "varde": (t[:200] + "…") if len(t) > 200 else t,
            })
    extra = {}
    last_edited_map = _dbuh_last_edited_map(db, list(all_ids))
    for gid in all_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_falt": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(all_ids), extra)
    return {"gravplatser": out, "antal": len(out)}



@router.get("/api/admin/databasunderhall/skisser")
async def get_databasunderhall_skisser(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Lista alla registrerade skisser (en rad per skiss) med gravplatsinfo.
    """
    rows = (
        db.query(GravplatsSkiss, Gravplats, MappConfig.namn)
        .join(Gravplats, GravplatsSkiss.gravplats_id == Gravplats.id)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .order_by(
            Gravplats.kyrkogard,
            Gravplats.kvarter,
            Gravplats.gravplatsnummer,
            Gravplats.start_sida,
            GravplatsSkiss.sort_order,
            GravplatsSkiss.id,
        )
        .all()
    )
    skisser = []
    for idx, (skiss_row, g, mapp_namn) in enumerate(rows):
        fullstandigt = _dbuh_format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer)
        slug = quote(fullstandigt, safe="") if fullstandigt else ""
        skisser.append({
            "index": idx,
            "gravplats_id": g.id,
            "fullstandigt": fullstandigt,
            "url_slug": slug,
            "mapp_namn": mapp_namn or "",
            "kyrkogard": (g.kyrkogard or "").strip(),
            "kvarter": (g.kvarter or "").strip(),
            "gravplatsnummer": (g.gravplatsnummer or "").strip(),
            "skiss": {
                "id": skiss_row.id,
                "x": skiss_row.x,
                "y": skiss_row.y,
                "width": skiss_row.width,
                "height": skiss_row.height,
                "source_type": skiss_row.source_type,
                "content_sida": skiss_row.content_sida,
                "segment_index": getattr(skiss_row, "segment_index", None),
                "halva": skiss_row.halva,
                "extramaterial_id": skiss_row.extramaterial_id,
            },
        })
    return {"skisser": skisser, "antal": len(skisser)}


@router.get("/api/admin/databasunderhall/anvandare-med-registreringar")
async def get_anvandare_med_registreringar(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lista användare som har minst en post i redigeringsloggen (för admin-granskning)."""
    rows = (
        db.query(User.id, User.username)
        .join(GravplatsRedigeringslogg, GravplatsRedigeringslogg.user_id == User.id)
        .distinct()
        .order_by(User.username)
        .all()
    )
    return {"anvandare": [{"id": r[0], "username": r[1] or ""} for r in rows]}


@router.get("/api/admin/databasunderhall/anvandare/{user_id:int}/registreringar")
async def get_anvandare_registreringar(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Lista gravplatser som användaren har redigerat, kronologiskt senast först.
    """
    subq = (
        db.query(
            GravplatsRedigeringslogg.gravplats_id,
            func.max(GravplatsRedigeringslogg.edited_at).label("last_edited"),
        )
        .filter(GravplatsRedigeringslogg.user_id == user_id)
        .group_by(GravplatsRedigeringslogg.gravplats_id)
    ).subquery()
    rows = (
        db.query(Gravplats, MappConfig.namn, subq.c.last_edited)
        .join(subq, Gravplats.id == subq.c.gravplats_id)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .order_by(subq.c.last_edited.desc())
        .all()
    )
    out = []
    for g, mapp_namn, last_edited in rows:
        out.append({
            "id": g.id,
            "kvarter": g.kvarter,
            "gravplatsnummer": g.gravplatsnummer,
            "start_sida": g.start_sida,
            "kyrkogard": g.kyrkogard,
            "mapp_namn": mapp_namn,
            "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
            "last_edited_at": last_edited,
        })
    return {"registreringar": out, "antal": len(out)}

