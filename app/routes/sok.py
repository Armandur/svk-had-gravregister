"""Avancerad sökning bland gravplatser, gravsatta och AI-svar."""
import re

from fastapi import APIRouter, Depends
from sqlalchemy import func, tuple_
from sqlalchemy.orm import Session

from app.database import (
    Extramaterial,
    Gravplats,
    GravplatsInmatning,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    Gravsatt,
    MappConfig,
    get_db,
)
from app.utils.ai_sok import ai_forslag, grav_matchar, gravsatt_matchar
from app.utils.gravplats_status import status_per_grav
from app.utils.text import _format_fullstandigt, _ledande_tal

router = APIRouter()


def _ar_ur_datumstr(s: str | None) -> int | None:
    """Plocka ut fyrsiffrigt årtal ur en datumsträng."""
    if not s or not s.strip():
        return None
    m = re.search(r"\b(1[6-9]\d{2}|20\d{2})\b", s.strip())
    return int(m.group(0)) if m else None


def _ai_rader(svar: dict, nyckel: str) -> list[dict]:
    return [x for x in (svar.get(nyckel) or []) if isinstance(x, dict)]


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
    inkludera_ai: bool = True,
    limit: int = 500,
):
    """Avancerad sökning med filter på gravplatser.

    Med inkludera_ai söks också AI-lästa gravar som ingen har granskat än, i det
    AI-svar gravvyn visar. Sådana rader har kalla "ai", modell och antal varningar.
    """
    filter_ = {k: v for k, v in locals().items() if k not in ("db", "resultat_typ", "limit", "inkludera_ai")}
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
    gp_with_em: set[int] = set()
    if har_extramaterial:
        sub = (
            db.query(Extramaterial.mapp_id, Extramaterial.grav_start_sida)
            .filter(Extramaterial.grav_start_sida.isnot(None))
            .distinct()
            .all()
        )
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
    if transkriberingsstatus in ("ej", "paborjad", "fardig", "ai", "ai_varning"):
        status_map, ai_varningar = status_per_grav(db)
        if transkriberingsstatus == "ej":
            q = q.filter(~Gravplats.id.in_(set(status_map)))
        elif transkriberingsstatus == "ai_varning":
            q = q.filter(Gravplats.id.in_({gid for gid, n in ai_varningar.items() if n}))
        else:
            q = q.filter(Gravplats.id.in_({gid for gid, st in status_map.items() if st == transkriberingsstatus}))
    elif ej_fardigtranskriberad:
        subq = db.query(GravplatsInmatning.gravplats_id).filter(
            GravplatsInmatning.fardigtranskriberad == True
        ).distinct()
        q = q.filter(~Gravplats.id.in_(subq))
    q = q.distinct().order_by(Gravplats.kyrkogard, Gravplats.kvarter, Gravplats.start_sida).limit(max(1, min(limit, 5000)))
    rows = q.all()

    # AI-lästa, ogranskade gravar: sök i AI-svaret och slå ihop med de mänskliga träffarna
    ai = ai_forslag(db) if transkriberingsstatus not in ("ej", "paborjad", "fardig") else {}
    if transkriberingsstatus == "ai_varning":
        ai = {gid: d for gid, d in ai.items() if d["varningar"]}
    if inkludera_ai and ai:
        aq = db.query(Gravplats).filter(Gravplats.id.in_(list(ai)))
        if kyrkogard and kyrkogard.strip():
            aq = aq.filter(Gravplats.kyrkogard.ilike("%" + kyrkogard.strip() + "%"))
        if kvarter and kvarter.strip():
            aq = aq.filter(Gravplats.kvarter.ilike("%" + kvarter.strip() + "%"))
        ai_rows = [g for g in aq.all() if grav_matchar(ai[g.id]["svar"], filter_)]
        if har_extramaterial:
            ai_rows = [g for g in ai_rows if g.id in gp_with_em]
        sammanslagna = {g.id: g for g in rows}
        sammanslagna.update({g.id: g for g in ai_rows})
        rows = list(sammanslagna.values())[: max(1, min(limit, 5000))]
    elif not inkludera_ai:
        rows = [g for g in rows if g.id not in ai]
    ai_ids = {g.id for g in rows if g.id in ai}
    ids = [g.id for g in rows]

    def _kalla(gid: int) -> dict:
        if gid in ai_ids:
            return {"kalla": "ai", "ai_modell": ai[gid]["modell"], "ai_varningar": ai[gid]["varningar"]}
        return {"kalla": "manniska"}
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
                **_kalla(inv.gravplats_id),
            })
        for gid in ai_ids:
            for inv in _ai_rader(ai[gid]["svar"], "innehavare"):
                out_inv.append({"gravplats_id": gid, "fullstandigt": fullstandigt_map.get(gid, ""),
                                **{k: inv.get(k) or "" for k in ("fornamn", "efternamn", "yrke", "gatuadress", "postnummer", "postort", "kommentar")},
                                **_kalla(gid)})
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
                **_kalla(na.gravplats_id),
            })
        for gid in ai_ids:
            for na in _ai_rader(ai[gid]["svar"], "narmast_anhoriga"):
                out_na.append({"gravplats_id": gid, "fullstandigt": fullstandigt_map.get(gid, ""),
                               **{k: na.get(k) or "" for k in ("fornamn", "efternamn", "yrke", "adress", "postnummer", "postort", "telefon", "kommentar")},
                               **_kalla(gid)})
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
                **_kalla(gs.gravplats_id),
            })
        for gid in ai_ids:
            for gs in _ai_rader(ai[gid]["svar"], "gravsatta"):
                if not gravsatt_matchar(gs, filter_):
                    continue
                out_gs.append({"gravplats_id": gid, "fullstandigt": fullstandigt_map.get(gid, ""),
                               "position": gs.get("position"), "ar_beteckning": bool(gs.get("ar_beteckning")),
                               **{k: gs.get(k) or "" for k in ("fornamn", "efternamn", "yrke", "gatuadress", "postnummer", "postort", "gravsatt_den", "urna", "kommentar")},
                               **{k: gs.get(k) for k in ("fodelse_ar", "fodelse_manad", "fodelse_dag", "dods_ar", "dods_manad", "dods_dag")},
                               **_kalla(gid)})
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
            **_kalla(g.id),
        })
        if g.id in ai_ids:
            svar = ai[g.id]["svar"]
            out[-1].update({
                "antal_innehavare": len(_ai_rader(svar, "innehavare")),
                "antal_narmast_anhoriga": len(_ai_rader(svar, "narmast_anhoriga")),
                "antal_gravsatta": len(_ai_rader(svar, "gravsatta")),
                "utfordat_den": svar.get("utfardat_den") or "",
            })
    out.sort(key=lambda x: (
        (x.get("kyrkogard") or "").lower(),
        (x.get("kvarter") or "").lower(),
        _ledande_tal(x.get("gravplatsnummer") or ""),
        (x.get("gravplatsnummer") or ""),
    ))
    return {"resultat_typ": "gravplatser", "gravplatser": out, "antal": len(out)}
