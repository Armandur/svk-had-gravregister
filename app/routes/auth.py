"""Auth-routes: login, logout, /api/me, preferenser, achievements."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import get_current_user, hash_password, verify_password
from app.database import (
    GravplatsRedigeringslogg,
    User,
    get_db,
)
from app.schemas import LoginBody, MePasswordBody, MePreferencesBody
from app.utils.achievements import _compute_achievements_niva
from app.utils.api_keys import _get_anthropic_api_key, _get_claude_instans_aktiv

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/login")
async def login(body: LoginBody, request: Request, db: Session = Depends(get_db)):
    """Logga in och sätt session."""
    user = db.query(User).filter(User.username == (body.username or "").strip()).first()
    if not user or not verify_password((body.password or ""), user.password_hash):
        raise HTTPException(status_code=401, detail="Fel användarnamn eller lösenord")
    request.session["user_id"] = user.id
    return {"ok": True, "username": user.username, "is_admin": user.is_admin}


@router.post("/api/logout")
async def logout(request: Request):
    """Logga ut – rensa session."""
    request.session.clear()
    return {"ok": True}


@router.put("/api/me/password")
async def change_my_password(
    body: MePasswordBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Byt eget lösenord – kräver att nuvarande lösenord anges."""
    if not verify_password(body.current_password or "", current_user.password_hash):
        raise HTTPException(status_code=400, detail="Felaktigt nuvarande lösenord")
    new_pw = (body.new_password or "").strip()
    if len(new_pw) < 4:
        raise HTTPException(status_code=400, detail="Det nya lösenordet är för kort (minst 4 tecken)")
    current_user.password_hash = hash_password(new_pw)
    db.commit()
    return {"ok": True}


@router.patch("/api/me/preferences")
async def patch_me_preferences(
    body: MePreferencesBody,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Uppdatera egna preferenser (roliga saker, toast/ljud vid nytt yrke, ordning på inmatningssektioner)."""
    prefs = {}
    if getattr(current_user, "preferences", None) and (current_user.preferences or "").strip():
        try:
            prefs = json.loads(current_user.preferences)
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning("Ogiltigt JSON i preferences för user_id=%s: %s", current_user.id, e)
    if body.fun_enabled is not None:
        prefs["fun_enabled"] = body.fun_enabled
    if body.toast_on_new_yrke is not None:
        prefs["toast_on_new_yrke"] = body.toast_on_new_yrke
    if body.sound_on_new_yrke is not None:
        prefs["sound_on_new_yrke"] = body.sound_on_new_yrke
    if body.inmatning_sections_order is not None:
        allowed = ["innehavare", "narmast_anhoriga", "gravplatsen", "skiss", "gravsatta"]
        unique = []
        for s in body.inmatning_sections_order:
            if s in allowed and s not in unique:
                unique.append(s)
        for s in allowed:
            if s not in unique:
                unique.append(s)
        prefs["inmatning_sections_order"] = unique
    current_user.preferences = json.dumps(prefs) if prefs else None
    db.commit()
    return {"ok": True, "preferences": prefs}


@router.get("/api/me")
async def me(current_user: User = Depends(get_current_user)):
    """Aktuell inloggad användare med preferenser."""
    prefs = {}
    if getattr(current_user, "preferences", None) and current_user.preferences.strip():
        try:
            prefs = json.loads(current_user.preferences)
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning("Ogiltigt JSON i preferences för user_id=%s: %s", current_user.id, e)
    default_sections = ["innehavare", "narmast_anhoriga", "gravplatsen", "skiss", "gravsatta"]
    sections_pref = prefs.get("inmatning_sections_order") or default_sections
    # Normalisera ordning (filtrerad + kompletterad)
    allowed = default_sections
    sections_order: list[str] = []
    for s in sections_pref:
        if s in allowed and s not in sections_order:
            sections_order.append(s)
    for s in allowed:
        if s not in sections_order:
            sections_order.append(s)
    claude_tillganglig = (
        bool(_get_anthropic_api_key())
        and _get_claude_instans_aktiv()
        and getattr(current_user, "claude_aktiv", True)
    )
    claude_batch_tillganglig = (
        claude_tillganglig
        and getattr(current_user, "claude_batch_aktiv", False)
    )
    return {
        "id": current_user.id,
        "username": current_user.username,
        "is_admin": current_user.is_admin,
        "claude_tillganglig": claude_tillganglig,
        "claude_batch_tillganglig": claude_batch_tillganglig,
        "preferences": {
            "fun_enabled": prefs.get("fun_enabled", True),
            "toast_on_new_yrke": prefs.get("toast_on_new_yrke", True),
            "sound_on_new_yrke": prefs.get("sound_on_new_yrke", True),
            "inmatning_sections_order": sections_order,
        },
    }


@router.get("/api/me/achievements")
async def me_achievements(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Statistik för prestationssidan: antal sparade registreringar, innehavare, gravsatta m.m. + achievement-nivåer."""
    first_last = (
        db.query(
            func.min(GravplatsRedigeringslogg.edited_at).label("first"),
            func.max(GravplatsRedigeringslogg.edited_at).label("last"),
        )
        .filter(GravplatsRedigeringslogg.user_id == current_user.id)
        .first()
    )
    first_at = first_last.first if first_last else None
    last_at = first_last.last if first_last else None
    nivaer = _compute_achievements_niva(db, current_user.id)
    # Rekonstruera antal från nivaer (så vi inte duplicerar logik)
    antal_registreringar = next((n["current_value"] for n in nivaer if n["achievement_key"] == "registreringar"), 0)
    antal_fardigtranskriberade = next((n["current_value"] for n in nivaer if n["achievement_key"] == "fardigtranskriberade"), 0)
    antal_innehavare = next((n["current_value"] for n in nivaer if n["achievement_key"] == "innehavare"), 0)
    antal_narmast_anhoriga = next((n["current_value"] for n in nivaer if n["achievement_key"] == "narmast_anhoriga"), 0)
    antal_gravsatta = next((n["current_value"] for n in nivaer if n["achievement_key"] == "gravsatta"), 0)
    antal_skisser = next((n["current_value"] for n in nivaer if n["achievement_key"] == "skisser"), 0)
    antal_unika_yrken = next((n["current_value"] for n in nivaer if n["achievement_key"] == "unika_yrken"), 0)
    return {
        "antal_registreringar": antal_registreringar,
        "antal_fardigtranskriberade": antal_fardigtranskriberade,
        "antal_innehavare": antal_innehavare,
        "antal_narmast_anhoriga": antal_narmast_anhoriga,
        "antal_gravsatta": antal_gravsatta,
        "antal_skisser": antal_skisser,
        "antal_unika_yrken": antal_unika_yrken,
        "forsta_registrering": first_at,
        "senaste_registrering": last_at,
        "nivaer": nivaer,
    }
