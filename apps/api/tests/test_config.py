import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_settings_loads_required_values_from_environment(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://user:pass@localhost:5432/testdb")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")

    # _env_file=None: ignore any real .env on disk so this test only ever
    # reflects the environment variables set above, not local dev secrets.
    settings = Settings(_env_file=None)

    assert settings.database_url == "postgresql+psycopg2://user:pass@localhost:5432/testdb"
    assert settings.jwt_secret_key == "test-secret"


def test_settings_uses_default_jwt_algorithm_when_not_set(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg2://user:pass@localhost:5432/testdb")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret")

    settings = Settings(_env_file=None)

    assert settings.jwt_algorithm == "HS256"


def test_settings_raises_when_required_values_are_missing(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("JWT_SECRET_KEY", raising=False)

    with pytest.raises(ValidationError):
        Settings(_env_file=None)
