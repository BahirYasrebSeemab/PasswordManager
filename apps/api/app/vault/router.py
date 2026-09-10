from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.core.rate_limit import limiter
from app.db.session import get_db
from app.vault.models import VaultEntry
from app.vault.schemas import VaultEntryCreate, VaultEntryResponse, VaultEntryUpdate

router = APIRouter(prefix="/vault", tags=["vault"])


@router.post("", response_model=VaultEntryResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_vault_entry(
    request: Request,
    payload: VaultEntryCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VaultEntry:
    entry = VaultEntry(user_id=current_user.id, ciphertext=payload.ciphertext)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


@router.get("", response_model=list[VaultEntryResponse])
@limiter.limit("60/minute")
def list_vault_entries(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[VaultEntry]:
    entries = db.scalars(
        select(VaultEntry)
        .where(VaultEntry.user_id == current_user.id)
        .order_by(VaultEntry.created_at.desc(), VaultEntry.id.desc())
    ).all()
    return list(entries)


def _get_owned_entry(entry_id: int, current_user: User, db: Session) -> VaultEntry:
    entry = db.scalars(
        select(VaultEntry).where(VaultEntry.id == entry_id, VaultEntry.user_id == current_user.id)
    ).first()
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vault entry not found")
    return entry


@router.get("/{entry_id}", response_model=VaultEntryResponse)
@limiter.limit("60/minute")
def get_vault_entry(
    request: Request,
    entry_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VaultEntry:
    return _get_owned_entry(entry_id, current_user, db)


@router.put("/{entry_id}", response_model=VaultEntryResponse)
@limiter.limit("30/minute")
def update_vault_entry(
    request: Request,
    entry_id: int,
    payload: VaultEntryUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> VaultEntry:
    entry = _get_owned_entry(entry_id, current_user, db)
    entry.ciphertext = payload.ciphertext
    db.commit()
    db.refresh(entry)
    return entry


@router.delete("/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_vault_entry(
    request: Request,
    entry_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    entry = _get_owned_entry(entry_id, current_user, db)
    db.delete(entry)
    db.commit()
