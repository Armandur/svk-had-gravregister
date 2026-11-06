"""Datakvalitets-routes: de specifika kontrollerna under /api/admin/databasunderhall/datakvalitet-*."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import (
    Gravplats,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    Gravsatt,
    User,
    get_db,
)
from app.utils.datakvalitet import (
    _dbuh_beteckning_problem,
    _dbuh_datum_problem,
    _dbuh_gravplats_lista,
    _dbuh_last_edited_map,
    _dbuh_namn_mellanslag_problem,
    _dbuh_postnummer_problem_rad,
    _dbuh_yrke_endast_siffror,
    _samla_f_problem,
)
from app.utils.kvittering import aktiva, kvitterade_per_grav
from app.utils.rimlighet import kontrollera

router = APIRouter()


@router.get("/api/admin/databasunderhall/datakvalitet-ofodd-f")
async def get_datakvalitet_ofodd_f(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """
    Lista gravplatser där någon innehavare, gravsatt eller närmast anhörig har förnamn/efternamn
    som innehåller ordet "f" utan punkt.
    """
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}

    for r in db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id.isnot(None)).all():
        detaljer = _samla_f_problem(r, "Innehavare")
        if detaljer:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(detaljer)

    for r in db.query(Gravsatt).filter(Gravsatt.gravplats_id.isnot(None)).all():
        detaljer = _samla_f_problem(r, "Gravsatt")
        if detaljer:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(detaljer)

    for r in db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id.isnot(None)).all():
        detaljer = _samla_f_problem(r, "Närmast anhörig")
        if detaljer:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(detaljer)

    if not all_ids:
        return {"gravplatser": [], "antal": 0}

    last_edited_map = _dbuh_last_edited_map(db, list(all_ids))
    extra = {}
    for gid in all_ids:
        lista = problem_per_gp.get(gid, [])
        inv_cnt = sum(1 for p in lista if p["roll"] == "Innehavare")
        gs_cnt = sum(1 for p in lista if p["roll"] == "Gravsatt")
        na_cnt = sum(1 for p in lista if p["roll"] == "Närmast anhörig")
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "antal_innehavare_f": inv_cnt,
            "antal_gravsatta_f": gs_cnt,
            "antal_narmast_anhorig_f": na_cnt,
            "problem_falt": lista,
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }

    out = _dbuh_gravplats_lista(db, list(all_ids), extra)
    return {"gravplatser": out, "antal": len(out)}



@router.get("/api/admin/databasunderhall/datakvalitet-datum")
async def get_datakvalitet_datum(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Gravplatser där gravsatta har datumproblem.

    Rimlighetsreglerna (född efter död, över 110 år, död efter gravsättning, ogiltig
    månad eller dag) är desamma som i gravvyn. Varningar som en granskare har
    kvitterat som riktiga visas inte. Dessutom: framtida år och korta årtal.
    """
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    per_grav: dict[int, list[Gravsatt]] = {}
    for gs in db.query(Gravsatt).filter(Gravsatt.gravplats_id.isnot(None)).order_by(Gravsatt.gravplats_id, Gravsatt.position, Gravsatt.id):
        per_grav.setdefault(gs.gravplats_id, []).append(gs)
    kvitterade = kvitterade_per_grav(db)
    antal_kvitterade = 0
    for gid, rader in per_grav.items():
        varningar = kontrollera({"gravsatta": [{f: getattr(g, f) for f in _RIMLIGHET_FALT} for g in rader]})
        aktiva_v = aktiva(varningar, kvitterade.get(gid))
        antal_kvitterade += len(varningar) - len(aktiva_v)
        for v in aktiva_v:
            problem_per_gp.setdefault(gid, []).append({
                "roll": "Gravsatt " + str(v["gravsatt"]), "falt": _REGEL_ETIKETT.get(v["regel"], "Datum"),
                "varde": v["meddelande"].split(": ", 1)[-1],
            })
        for gs in rader:
            problem_per_gp.setdefault(gid, []).extend(_dbuh_datum_problem(gs))
    all_ids = {gid for gid, p in problem_per_gp.items() if p}
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
    return {"gravplatser": out, "antal": len(out), "antal_kvitterade": antal_kvitterade}


_RIMLIGHET_FALT = ("fodelse_ar", "fodelse_manad", "fodelse_dag", "dods_ar", "dods_manad", "dods_dag", "gravsatt_den")
_REGEL_ETIKETT = {
    "dod_fore_fodsel": "Född efter död",
    "over_110_ar": "Över 110 år",
    "dod_efter_gravsattning": "Gravsatt före död",
    "ogiltig_fodelse_manad": "Födelsemånad",
    "ogiltig_dods_manad": "Dödsmånad",
    "ogiltig_fodelse_dag": "Födelsedag",
    "ogiltig_dods_dag": "Dödsdag",
    "ogiltigt_fodelsedatum": "Födelsedatum finns inte",
    "ogiltigt_dodsdatum": "Dödsdatum finns inte",
}


@router.get("/api/admin/databasunderhall/datakvalitet-postnummer-adress")
async def get_datakvalitet_postnummer_adress(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Gravplatser där postnummer inte är 5 siffror, eller postort innehåller siffror / OCR-misstankar."""
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for r in db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id.isnot(None)).all():
        adr = getattr(r, "gatuadress", None) or getattr(r, "adress", None)
        pnr = getattr(r, "postnummer", None) or ""
        port = getattr(r, "postort", None) or ""
        if not pnr and not port:
            continue
        probs = _dbuh_postnummer_problem_rad("Innehavare", pnr, port)
        if probs:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(probs)
    for r in db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id.isnot(None)).all():
        pnr = getattr(r, "postnummer", None) or ""
        port = getattr(r, "postort", None) or ""
        if not pnr and not port:
            continue
        probs = _dbuh_postnummer_problem_rad("Närmast anhörig", pnr, port)
        if probs:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(probs)
    for r in db.query(Gravsatt).filter(Gravsatt.gravplats_id.isnot(None)).all():
        pnr = getattr(r, "postnummer", None) or ""
        port = getattr(r, "postort", None) or ""
        if not pnr and not port:
            continue
        probs = _dbuh_postnummer_problem_rad("Gravsatt pos " + str(r.position), pnr, port)
        if probs:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(probs)
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


@router.get("/api/admin/databasunderhall/datakvalitet-dubbletter")
async def get_datakvalitet_dubbletter(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Gravplatser som har samma beteckning (kyrkogård + kvarter + gravplatsnummer) som en annan gravplats."""
    rows = (
        db.query(Gravplats.id, Gravplats.kyrkogard, Gravplats.kvarter, Gravplats.gravplatsnummer)
        .filter(Gravplats.kyrkogard.isnot(None), Gravplats.kyrkogard != "")
        .all()
    )
    key_to_ids: dict[tuple[str, str, str], list[int]] = {}
    for gid, kg, kv, gn in rows:
        key = ((kg or "").strip(), (kv or "").strip(), (gn or "").strip())
        if not key[0] and not key[1] and not key[2]:
            continue
        key_to_ids.setdefault(key, []).append(gid)
    dubblett_ids = set()
    for ids in key_to_ids.values():
        if len(ids) > 1:
            dubblett_ids.update(ids)
    problem_per_gp: dict[int, list[dict]] = {}
    for key, ids in key_to_ids.items():
        if len(ids) <= 1:
            continue
        andra = [i for i in ids if i != ids[0]]
        beskrivning = "Dubblett: samma beteckning som gravplats " + ", ".join(str(i) for i in andra)
        for gid in ids:
            problem_per_gp.setdefault(gid, []).append({
                "roll": "Gravplats",
                "falt": "Beteckning",
                "varde": beskrivning,
            })
    extra = {}
    last_edited_map = _dbuh_last_edited_map(db, list(dubblett_ids))
    for gid in dubblett_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_falt": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(dubblett_ids), extra)
    return {"gravplatser": out, "antal": len(out)}


@router.get("/api/admin/databasunderhall/datakvalitet-innehavare-gravsatta")
async def get_datakvalitet_innehavare_gravsatta(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Gravplatser som har gravsatta men ingen innehavare, eller innehavare men inga gravsatta."""
    has_inv = {r[0] for r in db.query(GravplatsInnehavare.gravplats_id).filter(GravplatsInnehavare.gravplats_id.isnot(None)).distinct().all()}
    has_gs = {r[0] for r in db.query(Gravsatt.gravplats_id).filter(Gravsatt.gravplats_id.isnot(None)).distinct().all()}
    all_gp_ids = {r[0] for r in db.query(Gravplats.id).all()}
    problem_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for gid in all_gp_ids:
        inv = gid in has_inv
        gs = gid in has_gs
        if gs and not inv:
            problem_ids.add(gid)
            problem_per_gp.setdefault(gid, []).append({"roll": "Gravplats", "falt": "Saknas", "varde": "Har gravsatta men ingen gravrättsinnehavare"})
        if inv and not gs:
            problem_ids.add(gid)
            problem_per_gp.setdefault(gid, []).append({"roll": "Gravplats", "falt": "Saknas", "varde": "Har innehavare men inga gravsatta"})
    extra = {}
    last_edited_map = _dbuh_last_edited_map(db, list(problem_ids))
    for gid in problem_ids:
        led = last_edited_map.get(gid, {})
        extra[gid] = {
            "problem_falt": problem_per_gp.get(gid, []),
            "last_edited_at": led.get("last_edited_at"),
            "last_edited_by_username": led.get("last_edited_by_username"),
        }
    out = _dbuh_gravplats_lista(db, list(problem_ids), extra)
    return {"gravplatser": out, "antal": len(out)}


@router.get("/api/admin/databasunderhall/datakvalitet-mellanslag")
async def get_datakvalitet_mellanslag(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Gravplatser där namnfält innehåller inledande/avslutande mellanslag eller dubbelmellanslag."""
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for r in db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id.isnot(None)).all():
        fn, en = getattr(r, "fornamn", None), getattr(r, "efternamn", None)
        nm = getattr(r, "namn", None)
        probs = _dbuh_namn_mellanslag_problem(fn, en, nm, "Innehavare")
        if probs:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(probs)
    for r in db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id.isnot(None)).all():
        fn, en = getattr(r, "fornamn", None), getattr(r, "efternamn", None)
        nm = getattr(r, "namn", None)
        probs = _dbuh_namn_mellanslag_problem(fn, en, nm, "Närmast anhörig")
        if probs:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(probs)
    for r in db.query(Gravsatt).filter(Gravsatt.gravplats_id.isnot(None)).all():
        fn, en = getattr(r, "fornamn", None), getattr(r, "efternamn", None)
        nm = getattr(r, "namn", None)
        probs = _dbuh_namn_mellanslag_problem(fn, en, nm, "Gravsatt pos " + str(r.position))
        if probs:
            all_ids.add(r.gravplats_id)
            problem_per_gp.setdefault(r.gravplats_id, []).extend(probs)
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


@router.get("/api/admin/databasunderhall/datakvalitet-yrke-langd")
async def get_datakvalitet_yrke_langd(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
    max_tecken: int = 250,
):
    """Gravplatser där yrkesfält bara innehåller siffror, eller fält som är ovanligt långa."""
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    langd_grans = max(50, min(max_tecken, 2000))

    for r in db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id.isnot(None)).all():
        yrke = getattr(r, "yrke", None) or ""
        if _dbuh_yrke_endast_siffror(yrke):
            problem_per_gp.setdefault(r.gravplats_id, []).append({"roll": "Innehavare", "falt": "Yrke", "varde": (yrke or "")[:80] + ("…" if len(str(yrke)) > 80 else "")})
            all_ids.add(r.gravplats_id)
        if len(str(yrke)) > langd_grans:
            problem_per_gp.setdefault(r.gravplats_id, []).append({"roll": "Innehavare", "falt": "Yrke (långt)", "varde": str(len(yrke)) + " tecken"})
            all_ids.add(r.gravplats_id)
    for r in db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id.isnot(None)).all():
        yrke = getattr(r, "yrke", None) or ""
        if _dbuh_yrke_endast_siffror(yrke):
            problem_per_gp.setdefault(r.gravplats_id, []).append({"roll": "Närmast anhörig", "falt": "Yrke", "varde": (yrke or "")[:80] + ("…" if len(str(yrke)) > 80 else "")})
            all_ids.add(r.gravplats_id)
        if len(str(yrke)) > langd_grans:
            problem_per_gp.setdefault(r.gravplats_id, []).append({"roll": "Närmast anhörig", "falt": "Yrke (långt)", "varde": str(len(yrke)) + " tecken"})
            all_ids.add(r.gravplats_id)
    for r in db.query(Gravsatt).filter(Gravsatt.gravplats_id.isnot(None)).all():
        yrke = getattr(r, "yrke", None) or ""
        if _dbuh_yrke_endast_siffror(yrke):
            problem_per_gp.setdefault(r.gravplats_id, []).append({"roll": "Gravsatt pos " + str(r.position), "falt": "Yrke", "varde": (yrke or "")[:80] + ("…" if len(str(yrke)) > 80 else "")})
            all_ids.add(r.gravplats_id)
        if len(str(yrke)) > langd_grans:
            problem_per_gp.setdefault(r.gravplats_id, []).append({"roll": "Gravsatt pos " + str(r.position), "falt": "Yrke (långt)", "varde": str(len(yrke)) + " tecken"})
            all_ids.add(r.gravplats_id)
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


@router.get("/api/admin/databasunderhall/datakvalitet-beteckning")
async def get_datakvalitet_beteckning(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Gravplatser som saknar kyrkogård, kvarter eller gravplatsnummer, eller har konstiga tecken i nummer."""
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for g in db.query(Gravplats).all():
        probs = _dbuh_beteckning_problem(g)
        if probs:
            all_ids.add(g.id)
            problem_per_gp[g.id] = probs
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
