"""Kvitterade rimlighetsvarningar: läsning och filtrering."""
from sqlalchemy.orm import Session

from app.database import RimlighetKvittering, User


def kvitterade_per_grav(db: Session, ids: set[int] | None = None) -> dict[int, set[str]]:
    """{gravplats_id: {nyckel, ...}} för alla kvitterade varningar."""
    q = db.query(RimlighetKvittering.gravplats_id, RimlighetKvittering.nyckel)
    if ids is not None:
        q = q.filter(RimlighetKvittering.gravplats_id.in_(ids))
    ut: dict[int, set[str]] = {}
    for gid, nyckel in q:
        ut.setdefault(gid, set()).add(nyckel)
    return ut


def markera(db: Session, gravplats_id: int, varningar: list[dict]) -> list[dict]:
    """Varningarna med "kvitterad": {kommentar, username, skapad_den} för de kvitterade, annars None."""
    rader = {
        k.nyckel: (k, username)
        for k, username in db.query(RimlighetKvittering, User.username)
        .join(User, RimlighetKvittering.user_id == User.id)
        .filter(RimlighetKvittering.gravplats_id == gravplats_id)
    }
    ut = []
    for v in varningar:
        k = rader.get(v.get("nyckel"))
        ut.append({**v, "kvitterad": {"kommentar": k[0].kommentar, "username": k[1] or "", "skapad_den": k[0].skapad_den} if k else None})
    return ut


def aktiva(varningar: list[dict], kvitterade: set[str] | None) -> list[dict]:
    """Varningar som inte är kvitterade."""
    return [v for v in varningar if v.get("nyckel") not in (kvitterade or set())]
