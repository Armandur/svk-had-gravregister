"""Autentisering: lösenord, session, get_current_user och require_admin."""
import bcrypt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.config import ADMIN_INITIAL_PASSWORD, SESSION_SECRET_KEY
from app.database import User, get_db


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(
            plain.encode("utf-8"),
            hashed.encode("utf-8") if isinstance(hashed, str) else hashed,
        )
    except Exception:
        return False


def get_current_user_id(request: Request) -> int | None:
    """Returnerar user_id från session om inloggad, annars None."""
    return request.session.get("user_id")


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    """Kräver inloggning. Returnerar aktuell användare eller 401."""
    user_id = get_current_user_id(request)
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Logga in för att fortsätta",
        )
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        request.session.clear()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ogiltig session",
        )
    return user


def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """Kräver inloggning och admin-roll."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Endast administratör kan utföra detta",
        )
    return current_user


def ensure_first_admin(db: Session) -> None:
    """Skapa första admin-användaren om inga användare finns och ADMIN_INITIAL_PASSWORD är satt."""
    if db.query(User).count() > 0:
        return
    if not (ADMIN_INITIAL_PASSWORD and ADMIN_INITIAL_PASSWORD.strip()):
        return
    admin = User(
        username="admin",
        password_hash=hash_password(ADMIN_INITIAL_PASSWORD.strip()),
        is_admin=True,
    )
    db.add(admin)
    db.commit()
