"""
Auth service: password hashing, JWT creation/verification, current-user dependency.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status, Cookie
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models.user import User, UserRole

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ALGORITHM = "HS256"

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def create_access_token(user_id: int, username: str, role: UserRole) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role.value,
        "exp": expire,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def _decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def _get_token(
    bearer: Optional[str] = Depends(oauth2_scheme),
    access_token: Optional[str] = Cookie(default=None),
) -> Optional[str]:
    """Accept JWT from Authorization header OR httpOnly cookie."""
    return bearer or access_token


def get_current_user(
    token: Optional[str] = Depends(_get_token),
    db: Session = Depends(get_db),
) -> User:
    # If auth has been disabled in system settings, return the first active admin
    from models.system_settings import SystemSettings
    sys = db.query(SystemSettings).first()
    if sys and not sys.auth_required:
        admin = db.query(User).filter(User.role == UserRole.admin, User.is_active == True).first()
        if admin:
            return admin

    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_error
    payload = _decode_token(token)
    if not payload:
        raise credentials_error
    user = db.get(User, int(payload["sub"]))
    if not user or not user.is_active:
        raise credentials_error
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


def require_editor(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role == UserRole.viewer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor access required")
    return current_user


def require_viewer(current_user: User = Depends(get_current_user)) -> User:
    """Any authenticated user."""
    return current_user
