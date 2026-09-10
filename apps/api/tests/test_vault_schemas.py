import pytest
from pydantic import ValidationError

from app.vault.schemas import VaultEntryCreate, VaultEntryUpdate


def test_vault_entry_create_accepts_nonempty_ciphertext():
    entry = VaultEntryCreate(ciphertext="c2FtcGxlLWNpcGhlcnRleHQ=")
    assert entry.ciphertext == "c2FtcGxlLWNpcGhlcnRleHQ="


def test_vault_entry_create_rejects_empty_ciphertext():
    with pytest.raises(ValidationError):
        VaultEntryCreate(ciphertext="")


def test_vault_entry_create_rejects_whitespace_only_ciphertext():
    with pytest.raises(ValidationError):
        VaultEntryCreate(ciphertext="   ")


def test_vault_entry_update_rejects_empty_ciphertext():
    with pytest.raises(ValidationError):
        VaultEntryUpdate(ciphertext="")
