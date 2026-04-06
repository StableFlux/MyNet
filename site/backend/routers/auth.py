"""
Auth router: login, logout, setup (first-run), current user.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models.user import User, UserRole
from services.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class SetupRequest(BaseModel):
    username: str
    display_name: str
    password: str
    email: str | None = None


class CreateUserRequest(BaseModel):
    username: str
    display_name: str
    password: str
    role: UserRole = UserRole.viewer
    email: str | None = None


class UpdateUserRequest(BaseModel):
    display_name: str | None = None
    email: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = None


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
    """Returns true if no users exist yet (first-run)."""
    return {"setup_required": db.query(User).count() == 0}


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
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
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
