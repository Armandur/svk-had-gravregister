"""Datakvalitets-routes: alla /api/admin/databasunderhall/datakvalitet-* och relaterade hjälpfunktioner."""
import re
from datetime import datetime, timezone
from urllib.parse import quote

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import (
    Gravplats,
    GravplatsInnehavare,
    GravplatsInmatning,
    GravplatsNarmastAnhorig,
    GravplatsRedigeringslogg,
    GravplatsSkiss,
    Gravsatt,
    MappConfig,
    User,
    get_db,
)
from app.utils.text import _format_fullstandigt

router = APIRouter()


# ─── Hjälpfunktioner (interna till datakvalitet) ──────────────────────────────

def _dbuh_format_fullstandigt(kyrkogard, kvarter, gravplatsnummer):
    """Hjälp för databasunderhåll: fullständig gravplatsbeteckning."""
    parts = [p for p in (kyrkogard, (kvarter or "").strip(), (gravplatsnummer or "").strip()) if p]
    return " ".join(parts) if parts else ""


def _dbuh_gravplats_lista(db, gravplats_ids, extra=None):
    """Returnerar lista med gravplatser (id, fullstandigt, mapp_namn, url_slug) + extra nycklar per id."""
    if not gravplats_ids:
        return []
    gravplatser = (
        db.query(Gravplats, MappConfig.namn)
        .join(MappConfig, Gravplats.mapp_id == MappConfig.id)
        .filter(Gravplats.id.in_(gravplats_ids))
        .all()
    )
    extra = extra or {}
    out = []
    for g, mapp_namn in gravplatser:
        fullstandigt = _dbuh_format_fullstandigt(g.kyrkogard, g.kvarter, g.gravplatsnummer)
        slug = quote(fullstandigt, safe="") if fullstandigt else ""
        row = {
            "id": g.id,
            "fullstandigt": fullstandigt,
            "mapp_namn": mapp_namn or "",
            "url_slug": slug,
        }
        for k, v in extra.get(g.id, {}).items():
            row[k] = v
        out.append(row)
    out.sort(key=lambda x: (x["fullstandigt"] or ""))
    return out


def _dbuh_last_edited_map(db, gravplats_ids: list[int]) -> dict[int, dict]:
    """Hämtar senast ändrad (tid + användare) per gravplats från GravplatsInmatning + User."""
    if not gravplats_ids:
        return {}
    rows = (
        db.query(GravplatsInmatning.gravplats_id, GravplatsInmatning.last_edited_at, User.username)
        .outerjoin(User, GravplatsInmatning.last_edited_by_user_id == User.id)
        .filter(GravplatsInmatning.gravplats_id.in_(gravplats_ids))
        .all()
    )
    result = {gid: {"last_edited_at": None, "last_edited_by_username": None} for gid in gravplats_ids}
    for gid, edited_at, username in rows:
        result[gid] = {"last_edited_at": edited_at, "last_edited_by_username": username}
    return result


# ---------- Generella fältkontroller ----------

_DBUH_FALT_LABELS = {
    "fornamn": "Förnamn", "efternamn": "Efternamn", "namn": "Namn", "yrke": "Yrke",
    "gatuadress": "Gatuadress", "adress": "Gatuadress", "postnummer": "Postnummer", "postort": "Postort",
    "kommentar": "Kommentar", "telefon": "Telefon",
    "kyrkogard": "Kyrkogård", "kvarter": "Kvarter", "gravplatsnummer": "Gravplatsnummer",
    "storlek": "Storlek", "underhall_text": "Underhåll", "gravrattstid": "Gravrättstid",
    "monument": "Monument", "gravens_utformning": "Gravens utformning", "karta_nr": "Karta nr",
    "gravbrev_nr": "Gravbrev nr", "utfordat_den": "Utfärdat den",
}


def _dbuh_falt_alla_config():
    """Returnerar konfiguration för generella fältverktyg: tabeller och fält med etiketter."""
    return [
        {"table": "innehavare", "table_label": "Innehavare", "fields": [
            {"field": "fornamn", "label": _DBUH_FALT_LABELS["fornamn"]}, {"field": "efternamn", "label": _DBUH_FALT_LABELS["efternamn"]},
            {"field": "namn", "label": _DBUH_FALT_LABELS["namn"]}, {"field": "yrke", "label": _DBUH_FALT_LABELS["yrke"]},
            {"field": "gatuadress", "label": _DBUH_FALT_LABELS["gatuadress"]}, {"field": "postnummer", "label": _DBUH_FALT_LABELS["postnummer"]},
            {"field": "postort", "label": _DBUH_FALT_LABELS["postort"]}, {"field": "kommentar", "label": _DBUH_FALT_LABELS["kommentar"]},
        ]},
        {"table": "narmast_anhorig", "table_label": "Närmast anhörig", "fields": [
            {"field": "fornamn", "label": _DBUH_FALT_LABELS["fornamn"]}, {"field": "efternamn", "label": _DBUH_FALT_LABELS["efternamn"]},
            {"field": "namn", "label": _DBUH_FALT_LABELS["namn"]}, {"field": "yrke", "label": _DBUH_FALT_LABELS["yrke"]},
            {"field": "adress", "label": _DBUH_FALT_LABELS["adress"]}, {"field": "postnummer", "label": _DBUH_FALT_LABELS["postnummer"]},
            {"field": "postort", "label": _DBUH_FALT_LABELS["postort"]}, {"field": "telefon", "label": _DBUH_FALT_LABELS["telefon"]},
            {"field": "kommentar", "label": _DBUH_FALT_LABELS["kommentar"]},
        ]},
        {"table": "gravsatt", "table_label": "Gravsatt", "fields": [
            {"field": "fornamn", "label": _DBUH_FALT_LABELS["fornamn"]}, {"field": "efternamn", "label": _DBUH_FALT_LABELS["efternamn"]},
            {"field": "namn", "label": _DBUH_FALT_LABELS["namn"]}, {"field": "yrke", "label": _DBUH_FALT_LABELS["yrke"]},
            {"field": "gatuadress", "label": _DBUH_FALT_LABELS["gatuadress"]}, {"field": "postnummer", "label": _DBUH_FALT_LABELS["postnummer"]},
            {"field": "postort", "label": _DBUH_FALT_LABELS["postort"]}, {"field": "kommentar", "label": _DBUH_FALT_LABELS["kommentar"]},
        ]},
        {"table": "gravplats", "table_label": "Gravplats", "fields": [
            {"field": "kyrkogard", "label": _DBUH_FALT_LABELS["kyrkogard"]}, {"field": "kvarter", "label": _DBUH_FALT_LABELS["kvarter"]},
            {"field": "gravplatsnummer", "label": _DBUH_FALT_LABELS["gravplatsnummer"]},
        ]},
        {"table": "inmatning", "table_label": "Inmatning", "fields": [
            {"field": "storlek", "label": _DBUH_FALT_LABELS["storlek"]}, {"field": "underhall_text", "label": _DBUH_FALT_LABELS["underhall_text"]},
            {"field": "gravrattstid", "label": _DBUH_FALT_LABELS["gravrattstid"]}, {"field": "monument", "label": _DBUH_FALT_LABELS["monument"]},
            {"field": "gravens_utformning", "label": _DBUH_FALT_LABELS["gravens_utformning"]}, {"field": "karta_nr", "label": _DBUH_FALT_LABELS["karta_nr"]},
            {"field": "gravbrev_nr", "label": _DBUH_FALT_LABELS["gravbrev_nr"]}, {"field": "utfordat_den", "label": _DBUH_FALT_LABELS["utfordat_den"]},
            {"field": "kommentar", "label": _DBUH_FALT_LABELS["kommentar"]},
        ]},
    ]


def _dbuh_parse_falt(falt_param: str) -> list[tuple[str, str]]:
    """Parsar 'falt'-param (table:field,table:field) till lista (table, field)."""
    if not falt_param or not falt_param.strip():
        return []
    out = []
    for part in falt_param.strip().split(","):
        part = part.strip()
        if ":" in part:
            t, f = part.split(":", 1)
            t, f = t.strip(), f.strip()
            if t and f:
                out.append((t, f))
    return out


def _dbuh_get_roll_label(table: str, row) -> str:
    if table == "innehavare":
        return "Innehavare"
    if table == "narmast_anhorig":
        return "Närmast anhörig"
    if table == "gravsatt":
        return "Gravsatt pos " + str(getattr(row, "position", ""))
    if table == "gravplats":
        return "Gravplats"
    if table == "inmatning":
        return "Inmatning"
    return table


def _dbuh_iter_falt(db: Session, falt_list: list[tuple[str, str]]):
    """Generator: (gravplats_id, roll, field_key, field_label, value) för varje valt (table, field) och varje rad."""
    tables_models = {
        "innehavare": (GravplatsInnehavare, "gravplats_id"),
        "narmast_anhorig": (GravplatsNarmastAnhorig, "gravplats_id"),
        "gravsatt": (Gravsatt, "gravplats_id"),
        "gravplats": (Gravplats, "id"),
        "inmatning": (GravplatsInmatning, "gravplats_id"),
    }
    for table, field in falt_list:
        if table not in tables_models or field not in _DBUH_FALT_LABELS:
            continue
        model, gid_attr = tables_models[table]
        field_label = _DBUH_FALT_LABELS.get(field, field)
        if not hasattr(model, field):
            continue
        rows = db.query(model).all()
        for row in rows:
            gid = getattr(row, gid_attr, None)
            if gid is None:
                continue
            val = getattr(row, field, None)
            if val is None:
                val = ""
            if not isinstance(val, str):
                val = str(val) if val is not None else ""
            roll = _dbuh_get_roll_label(table, row)
            yield (gid, roll, field, field_label, val)


# ---------- Specifika datakvalitetsfunktioner ----------

# "f" som ord utan punkt
_RE_OFODD_F_UTAN_PUNKT = re.compile(r"(^|\s)f(?!\.)(\s|$)")


def _namn_har_f_utan_punkt(s: str | None) -> bool:
    """True om strängen innehåller ordet 'f' utan punkt."""
    if not s or not isinstance(s, str):
        return False
    return _RE_OFODD_F_UTAN_PUNKT.search(s) is not None


_FALT_NAMN = {"fornamn": "Förnamn", "efternamn": "Efternamn", "namn": "Namn"}


def _kombinerat_namn(r) -> str:
    """Kombinerat namn från förnamn + efternamn, eller legacy namn-fält."""
    fn = (getattr(r, "fornamn", None) or "").strip()
    en = (getattr(r, "efternamn", None) or "").strip()
    komb = " ".join(filter(None, [fn, en])).strip()
    if komb:
        return komb
    return (getattr(r, "namn", None) or "").strip()


def _samla_f_problem(r, roll: str) -> list[dict]:
    """Returnerar högst en post per person om något namnfält innehåller 'f' utan punkt."""
    for col in _FALT_NAMN:
        v = getattr(r, col, None)
        if v and _namn_har_f_utan_punkt(v):
            return [{"roll": roll, "falt": "Namn", "varde": _kombinerat_namn(r)}]
    return []


def _namnfalt_har_siffror_eller_komma(s: str | None) -> bool:
    if not s or not isinstance(s, str):
        return False
    return bool(re.search(r"[0-9,]", s))


def _namnfalt_har_komma(s: str | None) -> bool:
    return bool(s and isinstance(s, str) and "," in s)


def _namnfalt_har_siffror(s: str | None) -> bool:
    if not s or not isinstance(s, str):
        return False
    return bool(re.search(r"[0-9]", s))


def _samla_namnfalt_problem(r, roll: str, typ: str = "bada") -> list[dict]:
    """Returnerar högst en post per person om namnfält matchar typ: 'komma', 'siffror' eller 'bada'."""
    def matchar(v):
        if not v:
            return False
        if typ == "komma":
            return _namnfalt_har_komma(v)
        if typ == "siffror":
            return _namnfalt_har_siffror(v)
        return _namnfalt_har_siffror_eller_komma(v)

    for col in _FALT_NAMN:
        v = getattr(r, col, None)
        if v and matchar(v):
            return [{"roll": roll, "falt": "Namn", "varde": _kombinerat_namn(r)}]
    return []


def _dbuh_datum_problem(gs: Gravsatt) -> list[dict]:
    """Returnerar problem med datum (gravsatt): födelse > död, framtida år, ogiltig månad/dag, kort årtal."""
    problems = []
    now_year = datetime.now(timezone.utc).year
    fa, fm, fd = gs.fodelse_ar, gs.fodelse_manad, gs.fodelse_dag
    da, dm, dd = gs.dods_ar, gs.dods_manad, gs.dods_dag

    if fa is not None and da is not None and fa > da:
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Datum", "varde": f"född {fa}, död {da} (född efter död)"})
    if fa is not None and fa > now_year:
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Födelseår", "varde": str(fa) + " (i framtiden)"})
    if da is not None and da > now_year:
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Dödsår", "varde": str(da) + " (i framtiden)"})
    if fm is not None and (fm < 1 or fm > 12):
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Födelsemånad", "varde": str(fm)})
    if dm is not None and (dm < 1 or dm > 12):
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Dödsmånad", "varde": str(dm)})
    if fd is not None and (fd < 1 or fd > 31):
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Födelsedag", "varde": str(fd)})
    if dd is not None and (dd < 1 or dd > 31):
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Dödsdag", "varde": str(dd)})
    if fa is not None and 0 < fa < 100:
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Födelseår", "varde": str(fa) + " (kort årtal, kontrollera)"})
    if da is not None and 0 < da < 100:
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Dödsår", "varde": str(da) + " (kort årtal, kontrollera)"})
    return problems


def _dbuh_postnummer_ok(s: str | None) -> bool:
    """True om postnummer är tomt eller giltigt (5 siffror, ev. med mellanslag)."""
    if not s or not isinstance(s, str):
        return True
    t = s.replace(" ", "").strip()
    return len(t) == 0 or (len(t) == 5 and t.isdigit())


def _dbuh_postnummer_problem_rad(roll: str, postnummer: str | None, postort: str | None) -> list[dict]:
    """Returnerar problem med postnummer/postort för en rad."""
    problems = []
    if postnummer and isinstance(postnummer, str):
        t = postnummer.replace(" ", "").strip()
        if t and (len(t) != 5 or not t.isdigit()):
            problems.append({"roll": roll, "falt": "Postnummer", "varde": postnummer})
        if re.search(r"[OolI]", postnummer):
            problems.append({"roll": roll, "falt": "Postnummer (OCR?)", "varde": postnummer + " (kan vara 0/O eller 1/l)"})
    if postort and isinstance(postort, str) and postort.strip():
        if re.search(r"\d", postort):
            problems.append({"roll": roll, "falt": "Postort", "varde": postort + " (innehåller siffror)"})
    return problems


def _dbuh_beteckning_problem(g: Gravplats) -> list[dict]:
    """Saknad eller konstig gravplatsbeteckning."""
    problems = []
    kg = (getattr(g, "kyrkogard", None) or "").strip()
    kv = (getattr(g, "kvarter", None) or "").strip()
    gn = (getattr(g, "gravplatsnummer", None) or "").strip()
    if not kg:
        problems.append({"roll": "Gravplats", "falt": "Kyrkogård", "varde": "Saknas"})
    if not kv:
        problems.append({"roll": "Gravplats", "falt": "Kvarter", "varde": "Saknas"})
    if not gn:
        problems.append({"roll": "Gravplats", "falt": "Gravplatsnummer", "varde": "Saknas"})
    if gn and re.search(r"[@#$%\[\]\\|{}<>]", gn):
        problems.append({"roll": "Gravplats", "falt": "Gravplatsnummer", "varde": gn + " (ovanliga tecken)"})
    return problems


def _dbuh_namn_mellanslag_problem(fornamn: str | None, efternamn: str | None, namn: str | None, roll: str) -> list[dict]:
    """Returnerar problem med mellanslag i namnfält."""
    problems = []
    for label, val in [("Förnamn", fornamn), ("Efternamn", efternamn), ("Namn", namn)]:
        if not val or not isinstance(val, str):
            continue
        if val != val.strip():
            problems.append({"roll": roll, "falt": label, "varde": repr(val) + " (inledande/avslutande mellanslag)"})
        if "  " in val:
            problems.append({"roll": roll, "falt": label, "varde": repr(val) + " (dubbelmellanslag)"})
    return problems


def _dbuh_yrke_endast_siffror(s: str | None) -> bool:
    if not s or not isinstance(s, str):
        return False
    t = s.strip()
    return len(t) > 0 and t.replace(" ", "").isdigit()


def _dbuh_matchar_siffror_komma(s: str, typ: str) -> bool:
    if not s or not isinstance(s, str):
        return False
    t = s.strip()
    if not t:
        return False
    if typ == "siffror":
        return any(c.isdigit() for c in t)
    if typ == "komma":
        return "," in t
    return any(c.isdigit() for c in t) or "," in t


# ─── API-endpoints ────────────────────────────────────────────────────────────

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


@router.get("/api/admin/databasunderhall/datakvalitet-datum")
async def get_datakvalitet_datum(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Gravplatser där gravsatta har datumproblem: födelse efter död, framtida år, ogiltig månad/dag, korta årtal."""
    all_ids = set()
    problem_per_gp: dict[int, list[dict]] = {}
    for gs in db.query(Gravsatt).filter(Gravsatt.gravplats_id.isnot(None)).all():
        probs = _dbuh_datum_problem(gs)
        if probs:
            all_ids.add(gs.gravplats_id)
            problem_per_gp.setdefault(gs.gravplats_id, []).extend(probs)
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
