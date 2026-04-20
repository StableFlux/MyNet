"""
Auth router: login, logout, setup (first-run), current user.
"""
import time
import threading
from collections import defaultdict
from datetime import datetime, timezone

import re as _re

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status

log = logging.getLogger(__name__)
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from database import get_db
from models.user import User, UserRole
from services.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin,
)

# ---------------------------------------------------------------------------
# Simple in-process rate limiter for login attempts
# Allows LOGIN_MAX_ATTEMPTS per IP within LOGIN_WINDOW_SECS.
# Resets after LOGIN_LOCKOUT_SECS of no attempts.
# ---------------------------------------------------------------------------

LOGIN_MAX_ATTEMPTS  = 10
LOGIN_WINDOW_SECS   = 60
LOGIN_LOCKOUT_SECS  = 300   # 5 minutes

_login_attempts: dict[str, list[float]] = defaultdict(list)
_login_lock = threading.Lock()


def _check_login_rate(ip: str) -> None:
    now = time.monotonic()
    with _login_lock:
        attempts = _login_attempts[ip]
        # Drop attempts outside the window
        attempts[:] = [t for t in attempts if now - t < LOGIN_WINDOW_SECS]
        if len(attempts) >= LOGIN_MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts — please wait before trying again.",
            )
        attempts.append(now)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

_EMAIL_RE = _re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def _validate_email(v: str | None) -> str | None:
    if v is None or v == '':
        return None
    if not _EMAIL_RE.match(v):
        raise ValueError('Invalid email address')
    return v


class SetupRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    email: str | None = None

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v): return _validate_email(v)


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    display_name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.viewer
    email: str | None = None

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v): return _validate_email(v)


class UpdateUserRequest(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)

    @field_validator('email', mode='before')
    @classmethod
    def validate_email(cls, v): return _validate_email(v)


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    email: str | None
    role: UserRole
    is_active: bool
    last_login: datetime | None

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# First-run check
# ---------------------------------------------------------------------------

@router.get("/setup-required")
def setup_required(db: Session = Depends(get_db)):
    """Returns true if no users exist yet (first-run).

    When the install is in first-run state, also reports any USB drive labelled
    `MYNET-STORAGE` that could seed this instance — see USB_STORAGE_DESIGN.md
    §6. The field is populated ONLY while no users exist, so there's no
    unauthenticated filesystem-info leak after setup.
    """
    users_count = db.query(User).count()
    payload: dict = {"setup_required": users_count == 0}
    if users_count == 0:
        try:
            from services import storage as _storage
            payload["storage_candidate"] = _storage.first_run_storage_candidate()
        except Exception:
            payload["storage_candidate"] = None
    return payload


class AdoptStorageRequest(BaseModel):
    usb_uuid: str


@router.post("/adopt-storage-candidate")
def adopt_storage_candidate(
    req: AdoptStorageRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Adopt a pre-existing MyNet database from a USB drive during first-run.

    Gated on users_count == 0 (same unauthenticated gate as /setup-required).
    Mounts the USB, installs the mount-dependency drop-in, swaps the DB_PATH
    symlink, persists storage_config.json, then schedules a service restart
    so the new DB becomes live. See USB_STORAGE_DESIGN.md §6.
    """
    if db.query(User).count() > 0:
        raise HTTPException(status_code=400, detail="Setup already complete")

    from services import storage as _storage
    if not _storage.is_platform_supported():
        raise HTTPException(status_code=501, detail=_storage.platform_unsupported_reason())

    # Verify the requested UUID matches the currently detected candidate —
    # prevents a crafted request from mounting a random USB.
    candidate = _storage.first_run_storage_candidate()
    if not candidate or candidate.get("uuid") != req.usb_uuid:
        raise HTTPException(status_code=400, detail="USB candidate not found or UUID mismatch")

    try:
        _storage.run_helper("mount", req.usb_uuid)
        _storage.run_helper("enable-mount-dependency", req.usb_uuid)
        _storage.run_helper("swap-symlink", str(_storage.MOUNT_POINT / "mynet.db"))
    except _storage.HelperError as e:
        raise HTTPException(status_code=502, detail=f"Storage setup failed: {e}")

    cfg = _storage.load_config()
    cfg.mode = _storage.MODE_USB
    cfg.usb_uuid = req.usb_uuid
    _storage.save_config(cfg)

    # Schedule the service restart AFTER the response flushes to the client.
    # Uses --no-block inside the helper so systemctl returns immediately;
    # the restart completes a few seconds later, by which point the client
    # has reloaded /setup-required and sees users exist on the new DB.
    def _schedule_restart():
        try:
            _storage.run_helper("service", "restart")
        except Exception as ex:
            log.warning(f"service restart after adoption failed: {ex}")

    background_tasks.add_task(_schedule_restart)
    return {"ok": True, "restart_scheduled": True, "restart_delay_ms": 1000}


@router.post("/setup", response_model=UserOut)
def setup(req: SetupRequest, db: Session = Depends(get_db)):
    """Create the initial admin user. Only callable when no users exist."""
    if db.query(User).count() > 0:
        raise HTTPException(status_code=400, detail="Setup already complete")
    user = User(
        username=req.username.lower().strip(),
        display_name=req.display_name,
        email=req.email,
        password_hash=hash_password(req.password),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Login / logout
# ---------------------------------------------------------------------------

@router.post("/login")
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    _check_login_rate(request.client.host if request.client else "unknown")
    user = db.query(User).filter(User.username == form.username.lower()).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")

    token = create_access_token(user.id, user.username, user.role)

    # Set httpOnly cookie (LAN use — no HTTPS requirement enforced in dev)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 8,
    )

    user.last_login = datetime.now(timezone.utc)
    db.commit()

    return {"access_token": token, "token_type": "bearer"}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("access_token")
    return {"detail": "Logged out"}


# ---------------------------------------------------------------------------
# Current user
# ---------------------------------------------------------------------------

@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


# ---------------------------------------------------------------------------
# User management (admin only)
# ---------------------------------------------------------------------------

@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    return db.query(User).order_by(User.id).all()


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(
    req: CreateUserRequest,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if db.query(User).filter(User.username == req.username.lower()).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    user = User(
        username=req.username.lower().strip(),
        display_name=req.display_name,
        email=req.email,
        password_hash=hash_password(req.password),
        role=req.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    req: UpdateUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if req.display_name is not None:
        user.display_name = req.display_name
    if req.email is not None:
        user.email = req.email
    if req.role is not None:
        # Prevent removing the last admin
        if req.role != UserRole.admin and user.role == UserRole.admin:
            admin_count = db.query(User).filter(
                User.role == UserRole.admin, User.is_active.is_(True)
            ).count()
            if admin_count <= 1:
                raise HTTPException(status_code=400, detail="Cannot demote the last admin")
        user.role = req.role
    if req.is_active is not None:
        user.is_active = req.is_active
    if req.password:
        user.password_hash = hash_password(req.password)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    if user.role == UserRole.admin:
        admin_count = db.query(User).filter(
            User.role == UserRole.admin, User.is_active.is_(True)
        ).count()
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Cannot delete the last admin")
    db.delete(user)
    db.commit()
