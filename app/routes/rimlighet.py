"""Rimlighetsvarningar på sparad data, och kvittering av varningar som stämmer med kortet."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import Gravplats, RimlighetKvittering, User, get_db
from app.utils.gravplats_utils import _inmatning_response
from app.utils.kvittering import markera
from app.utils.rimlighet import kontrollera

router = APIRouter()


class KvitteraBody(BaseModel):
    kommentar: str = ""


def _hitta_grav(db: Session, gravplats_id: int) -> None:
    if not db.query(Gravplats.id).filter(Gravplats.id == gravplats_id).first():
        raise HTTPException(status_code=404, detail="Gravplatsen hittades inte")


@router.get("/api/gravplats/{gravplats_id:int}/rimlighet")
async def rimlighet_sparad(gravplats_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Rimlighetsvarningar på det som är sparat för graven, med kvitteringar."""
    _hitta_grav(db, gravplats_id)
    data = _inmatning_response(gravplats_id, db)
    return {"varningar": markera(db, gravplats_id, kontrollera({"gravsatta": data.get("gravsatta") or []}))}


@router.post("/api/gravplats/{gravplats_id:int}/rimlighet/{nyckel}/kvittera")
async def kvittera(gravplats_id: int, nyckel: str, body: KvitteraBody, db: Session = Depends(get_db),
                   current_user: User = Depends(get_current_user)):
    """Granskaren har kontrollerat varningen mot kortet: kortet säger faktiskt så."""
    _hitta_grav(db, gravplats_id)
    rad = db.query(RimlighetKvittering).filter(RimlighetKvittering.gravplats_id == gravplats_id,
                                               RimlighetKvittering.nyckel == nyckel).first()
    if rad is None:
        rad = RimlighetKvittering(gravplats_id=gravplats_id, nyckel=nyckel)
        db.add(rad)
    rad.kommentar = body.kommentar.strip()[:1000]
    rad.user_id = current_user.id
    rad.skapad_den = datetime.now(timezone.utc).isoformat()
    db.commit()
    return {"ok": True}


@router.delete("/api/gravplats/{gravplats_id:int}/rimlighet/{nyckel}/kvittera")
async def angra_kvittering(gravplats_id: int, nyckel: str, db: Session = Depends(get_db),
                           current_user: User = Depends(get_current_user)):
    db.query(RimlighetKvittering).filter(RimlighetKvittering.gravplats_id == gravplats_id,
                                         RimlighetKvittering.nyckel == nyckel).delete()
    db.commit()
    return {"ok": True}
