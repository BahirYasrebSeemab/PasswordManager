from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.schemas import RegisterRequest, TokenResponse
from app.auth.security import create_access_token
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.security import hash_password

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
