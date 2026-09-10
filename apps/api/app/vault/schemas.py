from datetime import datetime

from pydantic import BaseModel, field_validator


class VaultEntryCreate(BaseModel):
    ciphertext: str

    @field_validator("ciphertext")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ciphertext must not be empty")
        return value


class VaultEntryUpdate(VaultEntryCreate):
    pass


class VaultEntryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    ciphertext: str
    created_at: datetime
    updated_at: datetime
