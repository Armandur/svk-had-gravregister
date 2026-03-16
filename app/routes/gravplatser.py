"""Rutter för gravplatser (registrering, sökning, halvor, dolda halvor)."""
import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func, or_, tuple_
from sqlalchemy.orm import Session

from app.database import (
    get_db,
    User,
    MappConfig,
    Extramaterial,
    Gravplats,
    GravplatsDoldHalva,
    GravplatsInmatning,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    GravplatsSkiss,
    Gravsatt,
)
from app.auth import get_current_user
from app.schemas import GravplatsSchema, DoldHalvaBody
from app.utils.text import _format_fullstandigt, _ledande_tal
from app.utils.pdf_utils import (
    _mapp_path,
    _excluded_filenames_for_mapp,
    _expanded_effective_list,
    _mapp_config_andelar,
    _mapp_config_andelar_per_position,
)
from app.utils.gravplats_utils import _gravplats_halvor

router = APIRouter()


@router.get("/api/mappar/{mapp_namn}/gravplats")
async def list_gravplats(mapp_namn: str, start_sida: int | None = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Lista registrerade gravplatser för mappen."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        return {"gravplatser": []}
    q = db.query(Gravplats).filter(Gravplats.mapp_id == mapp_config.id)
    if start_sida is not None:
        q = q.filter(Gravplats.start_sida == start_sida)
    items = q.order_by(Gravplats.start_sida, Gravplats.segment_index).all()
    return {
        "gravplatser": [
            {
                "id": g.id,
                "kvarter": g.kvarter,
                "gravplatsnummer": g.gravplatsnummer,
                "start_sida": g.start_sida,
                "segment_index": getattr(g, "segment_index", 0),
                "kyrkogard": g.kyrkogard,
                "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
                "sida1_ovre_tillhor_denna": getattr(g, "sida1_ovre_tillhor_denna", False),
                "sida3_ovre_tillhor_nasta": getattr(g, "sida3_ovre_tillhor_nasta", False),
            }
            for g in items
        ],
    }


@router.get("/api/gravplatser/trad")
async def gravplatser_trad(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Trädstruktur: kyrkogårdar med underliggande kvarter."""
    filt = and_(
        Gravplats.kyrkogard.isnot(None),
        Gravplats.kyrkogard != "",
        Gravplats.kvarter.isnot(None),
        Gravplats.kvarter != "",
        Gravplats.gravplatsnummer.isnot(None),
        Gravplats.gravplatsnummer != "",
    )
    rows = (
        db.query(Gravplats.kyrkogard, Gravplats.kvarter)
        .filter(filt)
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
    kyrkogardar = sorted(trad.keys(), key=lambda x: (x.upper(), x))
    count_rows = (
        db.query(Gravplats.kyrkogard, Gravplats.kvarter, func.count(Gravplats.id).label("antal"))
        .filter(filt)
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


@router.get("/api/gravplatser/forslag/kyrkogardar")
async def forslag_kyrkogardar(q: str = "", limit: int = 30, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    return {"forslag": [r[0].strip() for r in rows if r[0] and r[0].strip()]}


@router.get("/api/gravplatser/forslag/kvarter")
async def forslag_kvarter(
    q: str = "",
    kyrkogard: str | None = None,
    limit: int = 30,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lazy-förslag på kvarter (prefix-match)."""
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
    return {"forslag": [r[0].strip() for r in rows if r[0] is not None and str(r[0]).strip()]}


@router.get("/api/gravplatser")
async def list_gravplats_global(
    kyrkogard: str,
    kvarter: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Lista gravplatser för en kyrkogård och kvarter (över alla mappar)."""
    if not kyrkogard.strip() or not kvarter.strip():
        return {"gravplatser": []}
    items = (
        db.query(Gravplats, MappConfig.namn)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .filter(
            Gravplats.kyrkogard == kyrkogard.strip(),
            Gravplats.kvarter == kvarter.strip(),
            Gravplats.gravplatsnummer.isnot(None),
            Gravplats.gravplatsnummer != "",
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
    out.sort(key=lambda x: (_ledande_tal(x.get("gravplatsnummer") or ""), (x.get("gravplatsnummer") or "")))
    return {"gravplatser": out}


@router.get("/api/gravplatser/nasta-ej-fardig")
async def nasta_ej_fardig_gravplats(
    kyrkogard: str | None = None,
    kvarter: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returnerar nästa gravplats som inte är markerad som färdigtranskriberad."""
    subq = db.query(GravplatsInmatning.gravplats_id).filter(
        GravplatsInmatning.fardigtranskriberad == True
    ).distinct()
    q = (
        db.query(Gravplats)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .filter(~Gravplats.id.in_(subq))
    )
    if kyrkogard and (kg := (kyrkogard or "").strip()):
        q = q.filter(Gravplats.kyrkogard == kg)
    if kvarter and (kv := (kvarter or "").strip()):
        q = q.filter(Gravplats.kvarter == kv)
    q = q.order_by(Gravplats.kyrkogard, Gravplats.kvarter, Gravplats.start_sida).limit(10000)
    rows = q.all()
    if not rows:
        raise HTTPException(status_code=404, detail="Ingen ej färdig gravplats hittades")
    rows_sorted = sorted(
        rows,
        key=lambda g: (
            g.kyrkogard or "",
            g.kvarter or "",
            _ledande_tal(g.gravplatsnummer or ""),
            g.gravplatsnummer or "",
        ),
    )
    first = rows_sorted[0]
    return {"fullstandigt": _format_fullstandigt(first.kyrkogard, first.kvarter, first.gravplatsnummer)}


@router.get("/api/gravplatser/sok")
async def sok_gravplatser(q: str = "", limit: int = 25, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Sök/förslag på gravplatser efter fullständigt gravplatsnummer."""
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
    out.sort(key=lambda x: (x["kyrkogard"] or "", x["kvarter"] or "", _ledande_tal(x.get("gravplatsnummer") or ""), (x.get("gravplatsnummer") or "")))
    return {"gravplatser": out}


def _ar_ur_datumstr(s: str | None) -> int | None:
    """Plocka ut fyrsiffrigt årtal ur en datumsträng."""
    if not s or not s.strip():
        return None
    m = re.search(r"\b(1[6-9]\d{2}|20\d{2})\b", s.strip())
    return int(m.group(0)) if m else None


@router.get("/api/gravplatser/avancerad-sok")
async def avancerad_sok_gravplatser(
    db: Session = Depends(get_db),
    resultat_typ: str = "gravplatser",
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
    transkriberingsstatus: str | None = None,
    limit: int = 500,
):
    """Avancerad sökning med filter på gravplatser."""
    q = db.query(Gravplats).join(MappConfig, Gravplats.mapp_id == MappConfig.id)
    if kyrkogard and kyrkogard.strip():
        q = q.filter(Gravplats.kyrkogard.ilike("%" + kyrkogard.strip() + "%"))
    if kvarter and kvarter.strip():
        q = q.filter(Gravplats.kvarter.ilike("%" + kvarter.strip() + "%"))
    if innehavare_fornamn and innehavare_fornamn.strip():
        sq = db.query(GravplatsInnehavare.gravplats_id).filter(GravplatsInnehavare.fornamn.ilike("%" + innehavare_fornamn.strip() + "%")).distinct()
        q = q.filter(Gravplats.id.in_(sq))
    if innehavare_efternamn and innehavare_efternamn.strip():
        sq = db.query(GravplatsInnehavare.gravplats_id).filter(GravplatsInnehavare.efternamn.ilike("%" + innehavare_efternamn.strip() + "%")).distinct()
        q = q.filter(Gravplats.id.in_(sq))
    if innehavare_yrke and innehavare_yrke.strip():
        sq = db.query(GravplatsInnehavare.gravplats_id).filter(GravplatsInnehavare.yrke.ilike("%" + innehavare_yrke.strip() + "%")).distinct()
        q = q.filter(Gravplats.id.in_(sq))
    if anhorig_fornamn and anhorig_fornamn.strip():
        sq = db.query(GravplatsNarmastAnhorig.gravplats_id).filter(GravplatsNarmastAnhorig.fornamn.ilike("%" + anhorig_fornamn.strip() + "%")).distinct()
        q = q.filter(Gravplats.id.in_(sq))
    if anhorig_efternamn and anhorig_efternamn.strip():
        sq = db.query(GravplatsNarmastAnhorig.gravplats_id).filter(GravplatsNarmastAnhorig.efternamn.ilike("%" + anhorig_efternamn.strip() + "%")).distinct()
        q = q.filter(Gravplats.id.in_(sq))
    if gravsatt_fornamn and gravsatt_fornamn.strip():
        sq = db.query(Gravsatt.gravplats_id).filter(Gravsatt.fornamn.ilike("%" + gravsatt_fornamn.strip() + "%")).distinct()
        q = q.filter(Gravplats.id.in_(sq))
    if gravsatt_efternamn and gravsatt_efternamn.strip():
        sq = db.query(Gravsatt.gravplats_id).filter(Gravsatt.efternamn.ilike("%" + gravsatt_efternamn.strip() + "%")).distinct()
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
    ids_fardiga = set()
    ids_med_data = set()
    if transkriberingsstatus in ("ej", "paborjad", "fardig") or ej_fardigtranskriberad:
        ids_fardiga = set(
            r.gravplats_id for r in db.query(GravplatsInmatning.gravplats_id).filter(
                GravplatsInmatning.fardigtranskriberad == True
            ).all()
        )
        for gid, in db.query(GravplatsInnehavare.gravplats_id).distinct().all():
            ids_med_data.add(gid)
        for gid, in db.query(GravplatsNarmastAnhorig.gravplats_id).distinct().all():
            ids_med_data.add(gid)
        for gid, in db.query(Gravsatt.gravplats_id).distinct().all():
            ids_med_data.add(gid)
        for gid, in db.query(GravplatsSkiss.gravplats_id).distinct().all():
            ids_med_data.add(gid)
        for r in db.query(GravplatsInmatning).filter(
            or_(
                GravplatsInmatning.storlek != "",
                GravplatsInmatning.underhall_text != "",
                GravplatsInmatning.gravrattstid != "",
                GravplatsInmatning.monument != "",
                GravplatsInmatning.gravens_utformning != "",
                GravplatsInmatning.gravplats_nr != "",
                GravplatsInmatning.karta_nr != "",
                GravplatsInmatning.gravbrev_nr != "",
                GravplatsInmatning.utfordat_den != "",
                GravplatsInmatning.kommentar != "",
                GravplatsInmatning.skiss_bild.isnot(None),
            )
        ).all():
            ids_med_data.add(r.gravplats_id)
    if transkriberingsstatus == "ej":
        q = q.filter(~Gravplats.id.in_(ids_med_data))
    elif transkriberingsstatus == "paborjad":
        q = q.filter(Gravplats.id.in_(ids_med_data), ~Gravplats.id.in_(ids_fardiga))
    elif transkriberingsstatus == "fardig":
        q = q.filter(Gravplats.id.in_(ids_fardiga))
    elif ej_fardigtranskriberad:
        subq = db.query(GravplatsInmatning.gravplats_id).filter(
            GravplatsInmatning.fardigtranskriberad == True
        ).distinct()
        q = q.filter(~Gravplats.id.in_(subq))
    q = q.distinct().order_by(Gravplats.kyrkogard, Gravplats.kvarter, Gravplats.start_sida).limit(max(1, min(limit, 5000)))
    rows = q.all()
    ids = [g.id for g in rows]
    fullstandigt_map = {g.id: _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer) for g in rows}

    if resultat_typ == "innehavare":
        inv_rows = (
            db.query(GravplatsInnehavare)
            .filter(GravplatsInnehavare.gravplats_id.in_(ids))
            .order_by(GravplatsInnehavare.gravplats_id, GravplatsInnehavare.sort_order, GravplatsInnehavare.id)
            .all()
        )
        out_inv = []
        for inv in inv_rows:
            out_inv.append({
                "gravplats_id": inv.gravplats_id,
                "fullstandigt": fullstandigt_map.get(inv.gravplats_id, ""),
                "fornamn": inv.fornamn or "",
                "efternamn": inv.efternamn or "",
                "yrke": inv.yrke or "",
                "gatuadress": getattr(inv, "gatuadress", None) or inv.adress or "",
                "postnummer": getattr(inv, "postnummer", None) or "",
                "postort": getattr(inv, "postort", None) or "",
                "kommentar": inv.kommentar or "",
            })
        return {"resultat_typ": "innehavare", "innehavare": out_inv, "antal": len(out_inv)}

    if resultat_typ == "narmast_anhoriga":
        na_rows = (
            db.query(GravplatsNarmastAnhorig)
            .filter(GravplatsNarmastAnhorig.gravplats_id.in_(ids))
            .order_by(GravplatsNarmastAnhorig.gravplats_id, GravplatsNarmastAnhorig.sort_order, GravplatsNarmastAnhorig.id)
            .all()
        )
        out_na = []
        for na in na_rows:
            out_na.append({
                "gravplats_id": na.gravplats_id,
                "fullstandigt": fullstandigt_map.get(na.gravplats_id, ""),
                "fornamn": na.fornamn or "",
                "efternamn": na.efternamn or "",
                "yrke": getattr(na, "yrke", None) or "",
                "adress": na.adress or "",
                "postnummer": na.postnummer or "",
                "postort": na.postort or "",
                "telefon": na.telefon or "",
                "kommentar": getattr(na, "kommentar", None) or "",
            })
        return {"resultat_typ": "narmast_anhoriga", "narmast_anhoriga": out_na, "antal": len(out_na)}

    if resultat_typ == "gravsatta":
        gs_q = db.query(Gravsatt).filter(Gravsatt.gravplats_id.in_(ids))
        if gravsatt_fornamn and gravsatt_fornamn.strip():
            gs_q = gs_q.filter(Gravsatt.fornamn.ilike("%" + gravsatt_fornamn.strip() + "%"))
        if gravsatt_efternamn and gravsatt_efternamn.strip():
            gs_q = gs_q.filter(Gravsatt.efternamn.ilike("%" + gravsatt_efternamn.strip() + "%"))
        if gravsatt_fodda_fran is not None:
            gs_q = gs_q.filter(Gravsatt.fodelse_ar >= gravsatt_fodda_fran)
        if gravsatt_fodda_till is not None:
            gs_q = gs_q.filter(Gravsatt.fodelse_ar <= gravsatt_fodda_till)
        if gravsatt_doda_fran is not None:
            gs_q = gs_q.filter(Gravsatt.dods_ar >= gravsatt_doda_fran)
        if gravsatt_doda_till is not None:
            gs_q = gs_q.filter(Gravsatt.dods_ar <= gravsatt_doda_till)
        gs_rows = gs_q.order_by(Gravsatt.gravplats_id, Gravsatt.position, Gravsatt.id).all()
        out_gs = []
        for gs in gs_rows:
            if gravsatt_gravsatta_fran is not None or gravsatt_gravsatta_till is not None:
                ar = _ar_ur_datumstr(gs.gravsatt_den) if gs.gravsatt_den else None
                if ar is None:
                    continue
                if gravsatt_gravsatta_fran is not None and ar < gravsatt_gravsatta_fran:
                    continue
                if gravsatt_gravsatta_till is not None and ar > gravsatt_gravsatta_till:
                    continue
            out_gs.append({
                "gravplats_id": gs.gravplats_id,
                "fullstandigt": fullstandigt_map.get(gs.gravplats_id, ""),
                "position": gs.position,
                "ar_beteckning": getattr(gs, "ar_beteckning", False),
                "fornamn": gs.fornamn or "",
                "efternamn": gs.efternamn or "",
                "yrke": getattr(gs, "yrke", None) or "",
                "gatuadress": getattr(gs, "gatuadress", None) or gs.adress or "",
                "postnummer": getattr(gs, "postnummer", None) or "",
                "postort": getattr(gs, "postort", None) or "",
                "fodelse_ar": gs.fodelse_ar,
                "fodelse_manad": gs.fodelse_manad,
                "fodelse_dag": gs.fodelse_dag,
                "dods_ar": gs.dods_ar,
                "dods_manad": gs.dods_manad,
                "dods_dag": gs.dods_dag,
                "gravsatt_den": gs.gravsatt_den or "",
                "urna": gs.urna or "",
                "kommentar": gs.kommentar or "",
            })
        return {"resultat_typ": "gravsatta", "gravsatta": out_gs, "antal": len(out_gs)}

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
    out.sort(key=lambda x: (
        (x.get("kyrkogard") or "").lower(),
        (x.get("kvarter") or "").lower(),
        _ledande_tal(x.get("gravplatsnummer") or ""),
        (x.get("gravplatsnummer") or ""),
    ))
    return {"resultat_typ": "gravplatser", "gravplatser": out, "antal": len(out)}


@router.get("/api/mappar/{mapp_namn}/gravplats/halvor")
async def get_gravplats_halvor(
    mapp_namn: str,
    kyrkogard: str | None = None,
    kvarter: str | None = None,
    gravplatsnummer: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Hämta vilka halvor som tillhör en gravplats."""
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
    layout_typ = getattr(mapp_config, "layout_typ", None) or "standard_3_sidor"
    foregaende = None
    if layout_typ == "standard_3_sidor":
        foregaende = (
            db.query(Gravplats)
            .filter(
                Gravplats.mapp_id == mapp_config.id,
                Gravplats.start_sida == g.start_sida - 2,
            )
            .first()
        )
    halvor = _gravplats_halvor(g, foregaende, layout_typ=layout_typ)
    excluded = _excluded_filenames_for_mapp(db, mapp_namn)
    expanded = _expanded_effective_list(mapp_namn, excluded, db)
    for h in halvor:
        sid = h.get("content_sida")
        if sid is not None and 1 <= sid <= len(expanded):
            item = expanded[sid - 1]
            if item.get("t") == "f":
                h["filnamn"] = item["v"]
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
    dold_halvor_rows = db.query(GravplatsDoldHalva).filter(GravplatsDoldHalva.gravplats_id == g.id).all()

    def _dold_segment(r):
        if getattr(r, "halva", None) == "ovre":
            return 0
        if getattr(r, "halva", None) == "nedre":
            return 1
        return getattr(r, "segment_index", 0)

    dold_segment_set = {(r.content_sida, _dold_segment(r)) for r in dold_halvor_rows}
    halvor = [h for h in halvor if (h.get("content_sida"), h.get("segment_index", 0)) not in dold_segment_set]
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
        seg = getattr(r, "segment_index", None)
        if seg is None and getattr(r, "halva", None) == "ovre":
            seg = 0
        elif seg is None and getattr(r, "halva", None) == "nedre":
            seg = 1
        elif seg is None:
            seg = 0
        dolda_lista.append({
            "type": "halva",
            "content_sida": r.content_sida,
            "segment_index": seg,
            "halva": getattr(r, "halva", None) or ("ovre" if seg == 0 else "nedre"),
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
            "segment_index": getattr(g, "segment_index", 0),
        },
        "mapp_namn": mapp_namn,
        "config": {
            "layout_typ": layout_typ,
            "dela_sidor": getattr(mapp_config, "dela_sidor", None) or "hojdled",
            "andelar": _mapp_config_andelar(mapp_config),
            "andelar_per_position": _mapp_config_andelar_per_position(mapp_config),
        },
        "halvor": halvor,
        "extramaterial": extramaterial_lista,
        "dolda": dolda_lista,
    }


@router.post("/api/gravplats/{gravplats_id:int}/dold-halva")
async def post_dold_halva(gravplats_id: int, body: DoldHalvaBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Dölj en vanlig gravplatsbild (segment) från bildraden."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    seg = body.segment_index if body.segment_index is not None else (1 if body.halva == "ovre" else 0)
    halva_val = body.halva or ("ovre" if seg == 1 else "nedre")
    existing = (
        db.query(GravplatsDoldHalva)
        .filter(
            GravplatsDoldHalva.gravplats_id == gravplats_id,
            GravplatsDoldHalva.content_sida == body.content_sida,
            GravplatsDoldHalva.segment_index == seg,
        )
        .first()
    )
    if not existing:
        row = GravplatsDoldHalva(gravplats_id=gravplats_id, content_sida=body.content_sida, segment_index=seg, halva=halva_val)
        db.add(row)
        db.commit()
    return {"ok": True}


@router.delete("/api/gravplats/{gravplats_id:int}/dold-halva")
async def delete_dold_halva(
    gravplats_id: int,
    content_sida: int,
    segment_index: int | None = None,
    halva: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Visa igen en dold vanlig gravplatsbild."""
    g = db.query(Gravplats).filter(Gravplats.id == gravplats_id).first()
    if not g:
        raise HTTPException(status_code=404, detail="Gravplats hittades inte")
    seg = segment_index if segment_index is not None else (1 if halva == "ovre" else 0)
    db.query(GravplatsDoldHalva).filter(
        GravplatsDoldHalva.gravplats_id == gravplats_id,
        GravplatsDoldHalva.content_sida == content_sida,
        GravplatsDoldHalva.segment_index == seg,
    ).delete()
    db.commit()
    return {"ok": True}


@router.post("/api/mappar/{mapp_namn}/gravplats")
async def save_gravplats(
    mapp_namn: str,
    body: GravplatsSchema,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Spara eller uppdatera gravplats för ett block."""
    _mapp_path(mapp_namn)
    mapp_config = db.query(MappConfig).filter(MappConfig.namn == mapp_namn).first()
    if not mapp_config:
        mapp_config = MappConfig(namn=mapp_namn)
        db.add(mapp_config)
        db.flush()
    kyrkogard = mapp_config.kyrkogard or None
    segment_idx = getattr(body, "segment_index", 0) or 0
    existing = (
        db.query(Gravplats)
        .filter(
            Gravplats.mapp_id == mapp_config.id,
            Gravplats.start_sida == body.start_sida,
            Gravplats.segment_index == segment_idx,
        )
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
            segment_index=segment_idx,
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
        "segment_index": getattr(g, "segment_index", 0),
        "kyrkogard": g.kyrkogard,
        "fullstandigt": _format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer),
        "sida1_ovre_tillhor_denna": g.sida1_ovre_tillhor_denna,
        "sida3_ovre_tillhor_nasta": g.sida3_ovre_tillhor_nasta,
    }
