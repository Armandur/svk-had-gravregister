"""Beräkning av achievement-nivåer (används av auth- och admin-routes)."""
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import (
    AchievementNiva,
    AchievementYrkesGrupp,
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
    mina_ids = [r[0] for r in db.query(mina_gravplatser_subq.c.gravplats_id).all()]

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
    antal_innehavare = 0
    antal_narmast_anhoriga = 0
    antal_gravsatta = 0
    antal_skisser = 0
    unika_yrken_set = set()
    # Yrkesbaserade achievements – grupper av yrken hämtas från databasen
    yrkes_grupper: dict[str, set[str]] = {}
    yrkes_rows = db.query(AchievementYrkesGrupp).all()
    for r in yrkes_rows:
        key = (r.achievement_key or "").strip()
        if not key:
            continue
        if key not in yrkes_grupper:
            yrkes_grupper[key] = set()
        yrke_val = (r.yrke or "").strip()
        if yrke_val:
            yrkes_grupper[key].add(yrke_val)
    yrkes_grupp_counts: dict[str, int] = {k: 0 for k in yrkes_grupper.keys()}
    if mina_ids:
        antal_innehavare = db.query(GravplatsInnehavare).filter(GravplatsInnehavare.gravplats_id.in_(mina_ids)).count()
        antal_narmast_anhoriga = db.query(GravplatsNarmastAnhorig).filter(GravplatsNarmastAnhorig.gravplats_id.in_(mina_ids)).count()
        antal_gravsatta = db.query(Gravsatt).filter(Gravsatt.gravplats_id.in_(mina_ids)).count()
        antal_skisser = db.query(GravplatsSkiss).filter(GravplatsSkiss.gravplats_id.in_(mina_ids)).count()
        for q in (
            db.query(GravplatsInnehavare.yrke).filter(GravplatsInnehavare.gravplats_id.in_(mina_ids)),
            db.query(GravplatsNarmastAnhorig.yrke).filter(GravplatsNarmastAnhorig.gravplats_id.in_(mina_ids)),
            db.query(Gravsatt.yrke).filter(Gravsatt.gravplats_id.in_(mina_ids)),
        ):
            for row in q.all():
                if row[0] is not None:
                    y = str(row[0]).strip()
                    if not y:
                        continue
                    unika_yrken_set.add(y)
                    # Räkna in yrket i alla relevanta dynamiska grupper
                    for key, yrken in yrkes_grupper.items():
                        if y in yrken:
                            yrkes_grupp_counts[key] = yrkes_grupp_counts.get(key, 0) + 1
    antal_unika_yrken = len(unika_yrken_set)

    # Antal gravplatser med mer än 3 gravsatta (storgravar) bland användarens gravplatser
    antal_storgravar = 0
    if mina_ids:
        gravsatta_per_gravplats = (
            db.query(Gravsatt.gravplats_id, func.count(Gravsatt.id).label("cnt"))
            .filter(Gravsatt.gravplats_id.in_(mina_ids))
            .group_by(Gravsatt.gravplats_id)
            .all()
        )
        antal_storgravar = sum(1 for _, cnt in gravsatta_per_gravplats if (cnt or 0) > 3)

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
        "yrke_kyrkans_man": "Kyrkans man",
        "yrke_havets_man": "Havets män",
        "yrke_handelns_furste": "Handelns furste",
        "yrke_fabrikens_herre": "Fabrikens herre",
        "yrke_hantverkets_mastare": "Hantverkets mästare",
        "yrke_lardomens_vaktare": "Lärdomens väktare",
        "yrke_lag_och_ordning": "Lag & ordning",
        "yrke_fruar_mamseller": "Fruar & mamseller",
        "yrke_jord_och_gard": "Jord och gård",
    }
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
