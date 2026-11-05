"""Förslag på skissmarkering för gravar som saknar skiss."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import Gravplats, SessionLocal, User, get_db
from app.utils.skissforslag import skissforslag

router = APIRouter()


def _berakna(gravplats_id: int) -> dict | None:
    with SessionLocal() as db:
        return skissforslag(db, gravplats_id)


@router.get("/api/gravplats/{gravplats_id:int}/skissforslag")
async def hamta_skissforslag(gravplats_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Förslag på skissmarkering, eller null om graven redan har skiss eller ingen ruta är ifylld.

    Bildmätningen tar några tiondels sekunder, så den körs i en egen tråd.
    """
    if not db.query(Gravplats.id).filter(Gravplats.id == gravplats_id).first():
        raise HTTPException(status_code=404, detail="Gravplatsen hittades inte")
    return {"forslag": await asyncio.to_thread(_berakna, gravplats_id)}
