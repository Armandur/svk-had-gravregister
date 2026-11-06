"""Rutter för gravplatser (registrering, enkel sökning, halvor, dolda halvor). Avancerad sökning: sok.py."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.database import (
    get_db,
    User,
    MappConfig,
    Extramaterial,
    Gravplats,
    GravplatsDoldHalva,
    GravplatsInmatning,
)
from app.auth import get_current_user
from app.schemas import GravplatsSchema, DoldHalvaBody
from app.utils.gravplats_status import ai_lasta
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
    """Nästa gravplats som inte är färdigtranskriberad. AI-lästa men ogranskade gravar kommer först."""
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
    # AI-lästa gravar först: de har ett förslag och går snabbast att granska
    ai = ai_lasta(db)
    rows_sorted = sorted(
        rows,
        key=lambda g: (
            g.id not in ai,
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
