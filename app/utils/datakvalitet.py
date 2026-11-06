"""Hjälpfunktioner för datakvalitet och databasunderhåll: gravplatslistor och fältkontroller."""
import re
from datetime import datetime, timezone
from urllib.parse import quote

from sqlalchemy.orm import Session

from app.database import (
    Gravplats,
    GravplatsInnehavare,
    GravplatsInmatning,
    GravplatsNarmastAnhorig,
    Gravsatt,
    MappConfig,
    User,
)


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
    """Datumproblem som rimlighetsreglerna inte täcker: framtida år och korta årtal.

    Född efter död, över 110 år, död efter gravsättning och ogiltig månad eller
    dag kommer från app/utils/rimlighet.py, så de kan kvitteras som i gravvyn.
    """
    problems = []
    now_year = datetime.now(timezone.utc).year
    fa, da = gs.fodelse_ar, gs.dods_ar

    if fa is not None and fa > now_year:
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Födelseår", "varde": str(fa) + " (i framtiden)"})
    if da is not None and da > now_year:
        problems.append({"roll": "Gravsatt pos " + str(gs.position), "falt": "Dödsår", "varde": str(da) + " (i framtiden)"})
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

