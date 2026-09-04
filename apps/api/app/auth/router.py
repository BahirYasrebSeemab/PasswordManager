from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.schemas import LoginRequest, RegisterRequest, TokenResponse
from app.auth.security import create_access_token
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.security import hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register(request: Request, payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing_user = db.scalars(select(User).where(User.email == payload.email)).first()
    if existing_user is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    # The DB's unique index on email (see migration a4c09501d04f) is the real
    # backstop against a race between this check and the insert below; a
    # concurrent duplicate registration would surface as a 500 rather than a
    # clean 409 in that rare case, which is an accepted limitation for now.
    user = User(email=payload.email, hashed_password=hash_password(payload.auth_key))
    db.add(user)
    db.commit()
    db.refresh(user)

    access_token = create_access_token(subject=user.id)
    return TokenResponse(access_token=access_token)


# Argon2 hash of a value nobody could ever supply as auth_key, used only to
# keep response timing constant when the looked-up email doesn't exist —
# see spec "Enumeration protection". Computed once at import time.
_DUMMY_HASH = hash_password("no-such-user-timing-guard")


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    invalid_credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
    )

    user = db.scalars(select(User).where(User.email == payload.email)).first()
    stored_hash = user.hashed_password if user is not None else _DUMMY_HASH

    # verify_password always runs, even when user is None, so a nonexistent
    # email takes the same amount of time as a wrong password — this is
    # what closes the timing side-channel described in the spec.
    password_matches = verify_password(payload.auth_key, stored_hash)

    if user is None or not password_matches:
        raise invalid_credentials_exception

    access_token = create_access_token(subject=user.id)
    return TokenResponse(access_token=access_token)
