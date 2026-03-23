"""Rutter för mappar, PDF-sidor och mappkonfiguration."""
import json
from collections import Counter, defaultdict
from pathlib import Path

import fitz  # PyMuPDF
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app.config import KÄLLDATA_DIR
from app.constants import CACHE_HEADERS
from app.database import (
    get_db,
    User,
    Kyrkogard,
    MappConfig,
    Extramaterial,
    Gravplats,
    GravplatsInmatning,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    GravplatsSkiss,
    Gravsatt,
)
from app.auth import get_current_user
from app.schemas import MappConfigSchema
from app.utils.pdf_utils import (
    _mapp_path,
    _pdf_sidnummer,
    _sorted_pdf_names,
    _expanded_effective_list,
    _excluded_filenames_for_mapp,
    _parse_exclude_param,
    _content_page_to_item,
    _blank_page_png_bytes,
    _mapp_config_andelar,
    _mapp_config_andelar_per_position,
    _clip_rect_for_segment,
    _redan_halva_filenames_for_mapp,
)
from app.utils.text import _ledande_tal

router = APIRouter()


@router.get("/api/mappar")
async def list_mappar(current_user: User = Depends(get_current_user)):
    """Lista undermappar under källdata."""
    if not KÄLLDATA_DIR.exists():
        return {"mappar": []}
    mappar = [
        d.name
        for d in KÄLLDATA_DIR.iterdir()
        if d.is_dir() and not d.name.startswith(".")
    ]
    return {"mappar": sorted(mappar)}


@router.get("/api/kyrkogardar")
async def list_kyrkogardar(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lista kyrkogårdar för grunddatahantering."""
    rows = db.query(Kyrkogard).order_by(Kyrkogard.kod).all()
    return {"kyrkogardar": [r.kod for r in rows]}


@router.get("/api/statistik")
async def get_statistik(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Aggregerad statistik för startsidan."""
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
                antal_pdf += len(_sorted_pdf_names(mapp_namn))
            except Exception:
                pass

    saknar = or_(
        Gravplats.kyrkogard.is_(None),
        Gravplats.kyrkogard == "",
        Gravplats.kvarter == "",
        Gravplats.gravplatsnummer == "",
    )
    gravplatser_saknar = db.query(Gravplats).filter(saknar).count()
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

    def _yrke_list(q):
        return [str(r[0]).strip() for r in q.all() if r[0] is not None and str(r[0]).strip()]
    alla_yrken = (
        _yrke_list(db.query(GravplatsInnehavare.yrke))
        + _yrke_list(db.query(GravplatsNarmastAnhorig.yrke))
        + _yrke_list(db.query(Gravsatt.yrke))
    )
    antal_unika_yrken = len({y.lower() for y in alla_yrken})
    total_gravplatser = db.query(Gravplats).count()

    transkriberings_rows = (
        db.query(
            Gravplats.kyrkogard,
            Gravplats.kvarter,
            func.count(Gravplats.id).label("total"),
            func.sum(
                case((GravplatsInmatning.fardigtranskriberad == True, 1), else_=0)
            ).label("fardiga"),
        )
        .outerjoin(GravplatsInmatning, Gravplats.id == GravplatsInmatning.gravplats_id)
        .filter(
            Gravplats.kyrkogard.isnot(None),
            Gravplats.kyrkogard != "",
            Gravplats.kvarter.isnot(None),
            Gravplats.kvarter != "",
        )
        .group_by(Gravplats.kyrkogard, Gravplats.kvarter)
        .all()
    )
    gravplatser_per_kvarter = (
        db.query(
            Gravplats.kyrkogard,
            Gravplats.kvarter,
            Gravplats.gravplatsnummer,
            GravplatsInmatning.fardigtranskriberad,
        )
        .outerjoin(GravplatsInmatning, Gravplats.id == GravplatsInmatning.gravplats_id)
        .filter(
            Gravplats.kyrkogard.isnot(None),
            Gravplats.kyrkogard != "",
            Gravplats.kvarter.isnot(None),
            Gravplats.kvarter != "",
        )
        .all()
    )
    kvarter_gravplatser_fardiga: dict[tuple[str, str], list] = {}
    for g in gravplatser_per_kvarter:
        kg = (g.kyrkogard or "").strip()
        kv = (g.kvarter or "").strip()
        key = (kg, kv)
        if key not in kvarter_gravplatser_fardiga:
            kvarter_gravplatser_fardiga[key] = []
        kvarter_gravplatser_fardiga[key].append((g.gravplatsnummer or "", bool(g.fardigtranskriberad)))
    for key in kvarter_gravplatser_fardiga:
        kvarter_gravplatser_fardiga[key].sort(
            key=lambda x: (_ledande_tal(x[0]), (x[0] or ""))
        )
    kvarter_gravplatser_fardiga_list: dict[tuple[str, str], list[bool]] = {
        k: [fardig for _, fardig in lst] for k, lst in kvarter_gravplatser_fardiga.items()
    }
    transk_total = 0
    transk_fardiga = 0
    per_kyrkogard: dict[str, dict] = {}
    for row in transkriberings_rows:
        kg = (row.kyrkogard or "").strip()
        kv = (row.kvarter or "").strip()
        total_val = row.total or 0
        fardiga_val = int(row.fardiga or 0)
        transk_total += total_val
        transk_fardiga += fardiga_val
        gravplatser_fardiga = kvarter_gravplatser_fardiga_list.get((kg, kv))
        if kg not in per_kyrkogard:
            per_kyrkogard[kg] = {"total": 0, "fardiga": 0, "kvarter": []}
        per_kyrkogard[kg]["total"] += total_val
        per_kyrkogard[kg]["fardiga"] += fardiga_val
        kvarter_item: dict = {"kvarter": kv, "total": total_val, "fardiga": fardiga_val}
        if gravplatser_fardiga is not None:
            kvarter_item["gravplatser_fardiga"] = gravplatser_fardiga
        per_kyrkogard[kg]["kvarter"].append(kvarter_item)
    kyrkogardar_data: list[dict] = []
    for kg in sorted(per_kyrkogard.keys(), key=lambda x: (x.upper(), x)):
        kvarter_list = per_kyrkogard[kg]["kvarter"]
        kvarter_list.sort(key=lambda x: (x["kvarter"].lower(), x["kvarter"]))
        kyrkogardar_data.append({
            "kyrkogard": kg,
            "total": per_kyrkogard[kg]["total"],
            "fardiga": per_kyrkogard[kg]["fardiga"],
            "kvarter": kvarter_list,
        })
    transkriberingsstatus = {
        "total": {"total": transk_total, "fardiga": transk_fardiga},
        "kyrkogardar": kyrkogardar_data,
    }
    return {
        "antal_mappar": antal_mappar,
        "antal_pdf": antal_pdf,
        "gravplatser_saknar_kyrkogard_kvarter_eller_nummer": gravplatser_saknar,
        "gravplatser_fullstandiga": gravplatser_fullstandiga,
        "gravplatser_fardigtranskriberade": antal_fardigtranskriberade,
        "total_gravplatser": total_gravplatser,
        "transkriberingsstatus": transkriberingsstatus,
        "antal_extramaterial": antal_extramaterial,
        "antal_innehavare": antal_innehavare,
        "antal_narmast_anhoriga": antal_narmast_anhoriga,
        "antal_gravsatta": antal_gravsatta,
        "antal_unika_yrken": antal_unika_yrken,
    }


def _alla_yrken_med_antal(db: Session) -> list[dict]:
    """Hämta alla yrken med förekomstantal, skiftlägesbaserat normaliserade.

    Varianter som bara skiljer sig i skiftläge (t.ex. "Biskop"/"biskop") slås ihop.
    Visningsnamnet väljs som den vanligaste varianten; vid lika antal föredras
    versal inledning, annars alfabetiskt första.
    """
    def yrke_values(q):
        return [str(r[0]).strip() for r in q.all() if r[0] is not None and str(r[0]).strip()]
    alla = (
        yrke_values(db.query(GravplatsInnehavare.yrke))
        + yrke_values(db.query(GravplatsNarmastAnhorig.yrke))
        + yrke_values(db.query(Gravsatt.yrke))
    )
    # Gruppera per lowercase-nyckel, räkna exakta varianter
    groups: dict[str, Counter] = defaultdict(Counter)
    for yrke in alla:
        groups[yrke.lower()][yrke] += 1
    result = []
    for variants in groups.values():
        display = max(variants, key=lambda v: (variants[v], v[0].isupper(), [-ord(c) for c in v]))
        result.append({"yrke": display, "antal": sum(variants.values())})
    return sorted(result, key=lambda x: x["yrke"].lower())


def _unika_yrken_set(db: Session) -> set[str]:
    """Returnera mängd av alla unika yrken (gemener) i databasen.

    Skiftlägesbaserat normaliserad – används för att avgöra om ett yrke är
    nytt i systemet ("nytt yrke"-toast).
    """
    def yrke_values(q):
        return [str(r[0]).strip() for r in q.all() if r[0] is not None and str(r[0]).strip()]
    alla = (
        yrke_values(db.query(GravplatsInnehavare.yrke))
        + yrke_values(db.query(GravplatsNarmastAnhorig.yrke))
        + yrke_values(db.query(Gravsatt.yrke))
    )
    return {y.lower() for y in alla}


@router.get("/api/yrken")
async def get_yrken(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lista alla unika yrken med antal förekomster, sorterade alfabetiskt."""
    return {"yrken": _alla_yrken_med_antal(db)}


@router.get("/api/mappar/{mapp_namn}/filer")
async def list_pdf_filer(mapp_namn: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lista PDF-filer och extramaterial."""
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


@router.get("/api/mappar/{mapp_namn}/sida/{sida_nummer}")
async def pdf_sida_bild(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
    exclude: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returnera en PDF-sida som PNG."""
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


@router.get("/api/mappar/{mapp_namn}/sida/{sida_nummer}/halva")
async def pdf_sida_halva(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
    halva: str | None = None,
    segment: int | None = None,
    position: int | None = None,
    split: float = 0.5,
    exclude: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returnera en del (segment) av en PDF-sida som PNG."""
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    if segment is not None:
        if segment < 0:
            raise HTTPException(status_code=400, detail="segment måste vara >= 0")
        segment_index = segment
    elif halva in ("nedre", "ovre"):
        segment_index = 1 if halva == "ovre" else 0
    else:
        segment_index = 0
    if split and not 0 < split < 1 and segment is None and halva:
        raise HTTPException(status_code=400, detail="split måste vara mellan 0 och 1")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn) | _parse_exclude_param(exclude)
    item = _content_page_to_item(mapp_namn, excluded, sida_nummer, db)
    if item is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    typ, val = item
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    dela_sidor = getattr(mapp_config, "dela_sidor", None) or "hojdled"
    andelar = _mapp_config_andelar(mapp_config, position=position) if mapp_config else _mapp_config_andelar(None, position=position)
    if typ == "blank":
        use_halva = "ovre" if segment_index == 0 else "nedre"
        use_split = andelar[0] if len(andelar) >= 1 else split
        png_bytes = _blank_page_png_bytes(dpi=150, split=use_split, halva=use_halva)
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    doc = fitz.open(val)
    try:
        page = doc[0]
        r = page.rect
        redan_halva_set = _redan_halva_filenames_for_mapp(db, mapp_config.id if mapp_config else None)
        if val.name in redan_halva_set or dela_sidor == "ingen":
            pix = page.get_pixmap(dpi=150)
        else:
            clip = _clip_rect_for_segment(r, segment_index, andelar, dela_sidor)
            if clip is not None:
                pix = page.get_pixmap(dpi=150, clip=clip)
            else:
                pix = page.get_pixmap(dpi=150)
        png_bytes = pix.tobytes("png")
        return Response(content=png_bytes, media_type="image/png", headers=CACHE_HEADERS)
    finally:
        doc.close()


@router.get("/api/mappar/{mapp_namn}/pdf/{sida_nummer}")
async def pdf_fil(
    mapp_namn: str,
    sida_nummer: int,
    offset: int = 0,
    exclude: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returnera själva PDF-filen (innehållssida)."""
    if offset < 0 or offset > 2:
        raise HTTPException(status_code=400, detail="offset måste vara 0, 1 eller 2")
    excluded = _excluded_filenames_for_mapp(db, mapp_namn) | _parse_exclude_param(exclude)
    item = _content_page_to_item(mapp_namn, excluded, sida_nummer, db)
    if item is None:
        raise HTTPException(status_code=404, detail="Sidan finns inte")
    typ, val = item
    if typ == "blank":
        raise HTTPException(status_code=404, detail="Tom sida – ingen PDF att ladda")
    return FileResponse(val, media_type="application/pdf", filename=val.name)


@router.get("/api/mappar/{mapp_namn}/config")
async def get_mapp_config(mapp_namn: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Hämta sparad konfiguration för mappen."""
    _mapp_path(mapp_namn)
    row = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not row:
        return {
            "mapp": mapp_namn,
            "kyrkogard": None,
            "gravkvarter": None,
            "forsett_antal": 0,
            "layout_typ": "standard_3_sidor",
            "dela_sidor": "hojdled",
            "antal_delar_per_sida": 2,
            "andelar": [0.5],
            "andelar_per_position": None,
        }
    andelar = _mapp_config_andelar(row)
    per_pos = getattr(row, "andelar_per_position", None)
    try:
        andelar_per_position = json.loads(per_pos) if isinstance(per_pos, str) and per_pos else (per_pos if isinstance(per_pos, dict) else None)
    except (TypeError, ValueError):
        andelar_per_position = None
    return {
        "mapp": mapp_namn,
        "kyrkogard": row.kyrkogard,
        "gravkvarter": row.gravkvarter,
        "forsett_antal": row.forsett_antal,
        "layout_typ": getattr(row, "layout_typ", None) or "standard_3_sidor",
        "dela_sidor": getattr(row, "dela_sidor", None) or "hojdled",
        "antal_delar_per_sida": getattr(row, "antal_delar_per_sida", None) or 2,
        "andelar": andelar,
        "andelar_per_position": andelar_per_position,
    }


@router.post("/api/mappar/{mapp_namn}/config")
async def save_mapp_config(
    mapp_namn: str,
    body: MappConfigSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Spara konfiguration för mappen."""
    _mapp_path(mapp_namn)
    row = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not row:
        row = MappConfig(namn=mapp_namn)
        db.add(row)
        db.flush()
    row.kyrkogard = body.kyrkogard
    row.gravkvarter = body.gravkvarter
    row.forsett_antal = max(0, min(2, body.forsett_antal))
    if body.layout_typ is not None and body.layout_typ in ("standard_3_sidor", "1_sida_per_grav", "2_gravar_per_sida"):
        row.layout_typ = body.layout_typ
    if body.dela_sidor is not None and body.dela_sidor in ("ingen", "hojdled", "breddled"):
        row.dela_sidor = body.dela_sidor
    if body.antal_delar_per_sida is not None and body.antal_delar_per_sida >= 1:
        row.antal_delar_per_sida = min(20, body.antal_delar_per_sida)
    if body.andelar is not None and len(body.andelar) >= 1:
        row.andelar = json.dumps([float(x) for x in body.andelar])
    if body.andelar_per_position is not None:
        row.andelar_per_position = json.dumps({k: [float(x) for x in v] for k, v in body.andelar_per_position.items() if isinstance(v, list) and v})
    db.commit()
    return {"ok": True}
