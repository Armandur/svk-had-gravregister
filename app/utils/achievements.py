"""Beräkning av achievement-nivåer (används av auth- och admin-routes)."""
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.database import (
    AchievementNiva,
    AchievementYrkesGrupp,
    AchievementYrkesKategori,
    GravplatsInnehavare,
    GravplatsNarmastAnhorig,
    GravplatsRedigeringslogg,
    GravplatsInmatning,
    GravplatsSkiss,
    Gravsatt,
)


def _compute_achievements_niva(db: Session, user_id: int) -> list[dict]:
    """Beräkna achievement-nivåer för en användare (används av me_achievements och put_inmatning)."""
    mina_gravplatser_subq = (
        db.query(GravplatsInmatning.gravplats_id).filter(
            GravplatsInmatning.last_edited_by_user_id == user_id
        ).distinct().subquery()
    )

    antal_registreringar = (
        db.query(GravplatsRedigeringslogg).filter(GravplatsRedigeringslogg.user_id == user_id).count()
    )
    antal_fardigtranskriberade = (
        db.query(GravplatsInmatning.gravplats_id)
        .filter(
            GravplatsInmatning.last_edited_by_user_id == user_id,
            GravplatsInmatning.fardigtranskriberad == True,
        )
        .distinct()
        .count()
    )

    # Yrkesbaserade achievements – grupper av yrken hämtas från databasen
    yrkes_grupper: dict[str, set[str]] = {}
    yrkes_rows = db.query(AchievementYrkesGrupp).all()
    for r in yrkes_rows:
        key = (r.achievement_key or "").strip()
        if not key:
            continue
        if key not in yrkes_grupper:
            yrkes_grupper[key] = set()
        yrke_val = (r.yrke or "").strip().lower()
        if yrke_val:
            yrkes_grupper[key].add(yrke_val)
    yrkes_grupp_counts: dict[str, int] = {k: 0 for k in yrkes_grupper.keys()}

    # Använd subquery direkt i IN-filter – undviker att materialisera potentiellt
    # tusentals gravplats-id:n i Python och skicka tillbaka dem som en stor IN-lista.
    antal_innehavare = db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id.in_(mina_gravplatser_subq)).count()
    antal_narmast_anhoriga = db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id.in_(mina_gravplatser_subq)).count()
    antal_gravsatta = db.query(Gravsatt).filter(Gravsatt.gravplats_id.in_(mina_gravplatser_subq)).count()
    antal_skisser = db.query(GravplatsSkiss).filter(GravplatsSkiss.gravplats_id.in_(mina_gravplatser_subq)).count()

    unika_yrken_set = set()
    for q in (
        db.query(GravplatsInnehavare.yrke).filter(GravplatsInnehavare.gravplats_id.in_(mina_gravplatser_subq)),
        db.query(GravplatsNarmastAnhorig.yrke).filter(GravplatsNarmastAnhorig.gravplats_id.in_(mina_gravplatser_subq)),
        db.query(Gravsatt.yrke).filter(Gravsatt.gravplats_id.in_(mina_gravplatser_subq)),
    ):
        for row in q.all():
            if row[0] is not None:
                y = str(row[0]).strip()
                if not y:
                    continue
                unika_yrken_set.add(y.lower())
                # Räkna in yrket i alla relevanta dynamiska grupper (skiftlägesokänslig)
                y_lower = y.lower()
                for key, yrken in yrkes_grupper.items():
                    if y_lower in yrken:
                        yrkes_grupp_counts[key] = yrkes_grupp_counts.get(key, 0) + 1
    antal_unika_yrken = len(unika_yrken_set)

    # Antal gravplatser med mer än 3 gravsatta (storgravar) bland användarens gravplatser
    gravsatta_per_gravplats = (
        db.query(Gravsatt.gravplats_id, func.count(Gravsatt.id).label("cnt"))
        .filter(Gravsatt.gravplats_id.in_(mina_gravplatser_subq))
        .group_by(Gravsatt.gravplats_id)
        .all()
    )
    antal_storgravar = sum(1 for _, cnt in gravsatta_per_gravplats if (cnt or 0) > 3)

    # Antal registreringar gjorda nattetid (22:00–05:59 UTC) – "Nattugglan"-achievement
    natt_result = db.execute(
        text(
            "SELECT COUNT(*) FROM gravplats_redigeringslogg"
            " WHERE user_id = :uid"
            " AND (CAST(strftime('%H', edited_at) AS INTEGER) >= 22"
            "      OR CAST(strftime('%H', edited_at) AS INTEGER) < 6)"
        ),
        {"uid": user_id},
    ).scalar()
    antal_nattugglan = int(natt_result or 0)

    # Antal registreringar gjorda tidigt på morgonen (05:00–07:59 UTC) – "Tidig fågel"-achievement
    tidig_result = db.execute(
        text(
            "SELECT COUNT(*) FROM gravplats_redigeringslogg"
            " WHERE user_id = :uid"
            " AND CAST(strftime('%H', edited_at) AS INTEGER) >= 5"
            " AND CAST(strftime('%H', edited_at) AS INTEGER) < 8"
        ),
        {"uid": user_id},
    ).scalar()
    antal_tidig_fagel = int(tidig_result or 0)

    # Antal registreringar gjorda på helger (lördag=6, söndag=0 i SQLite) – "Helgarbetare"-achievement
    helg_result = db.execute(
        text(
            "SELECT COUNT(*) FROM gravplats_redigeringslogg"
            " WHERE user_id = :uid"
            " AND strftime('%w', edited_at) IN ('0', '6')"
        ),
        {"uid": user_id},
    ).scalar()
    antal_helgarbetare = int(helg_result or 0)

    niva_rows = db.query(AchievementNiva).order_by(AchievementNiva.achievement_key, AchievementNiva.threshold).all()
    key_to_thresholds = {}
    for n in niva_rows:
        key = n.achievement_key
        if key not in key_to_thresholds:
            key_to_thresholds[key] = {}
        key_to_thresholds[key][n.level] = {"threshold": n.threshold, "label": n.label or str(n.threshold)}

    value_by_key = {
        "registreringar": antal_registreringar,
        "fardigtranskriberade": antal_fardigtranskriberade,
        "innehavare": antal_innehavare,
        "narmast_anhoriga": antal_narmast_anhoriga,
        "gravsatta": antal_gravsatta,
        "skisser": antal_skisser,
        "unika_yrken": antal_unika_yrken,
        "storgravar": antal_storgravar,
        "nattugglan": antal_nattugglan,
        "tidig_fagel": antal_tidig_fagel,
        "helgarbetare": antal_helgarbetare,
    }
    # Lägg till alla dynamiska yrkesgrupper i value_by_key
    for key, count in yrkes_grupp_counts.items():
        value_by_key[key] = count
    achievement_labels_sv = {
        "registreringar": "Sparade registreringar",
        "fardigtranskriberade": "Färdigtranskriberade gravplatser",
        "innehavare": "Gravrättsinnehavare",
        "narmast_anhoriga": "Närmast anhöriga",
        "gravsatta": "Gravsatta",
        "skisser": "Skisser",
        "unika_yrken": "Unika yrken",
        "storgravar": "Storgravar (>3 gravsatta)",
        "nattugglan": "Nattugglan 🦉",
        "tidig_fagel": "Tidig fågel ☀️",
        "helgarbetare": "Helgarbetare 📅",
    }
    # Lägg till yrkeskategoriers visningsnamn från databasen
    for r in db.query(AchievementYrkesKategori).all():
        achievement_labels_sv[r.achievement_key] = r.namn
    nivaer = []
    for key, thresholds in key_to_thresholds.items():
        value = value_by_key.get(key, 0)
        earned = None
        for level in ("gold", "silver", "bronze"):
            if level in thresholds and value >= thresholds[level]["threshold"]:
                earned = level
                break
        nivaer.append({
            "achievement_key": key,
            "label": achievement_labels_sv.get(key, key),
            "bronze": thresholds.get("bronze"),
            "silver": thresholds.get("silver"),
            "gold": thresholds.get("gold"),
            "current_value": value,
            "earned_level": earned,
        })
    return nivaer
