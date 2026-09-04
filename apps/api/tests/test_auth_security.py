from datetime import datetime, timedelta, timezone

import pytest
from jose import jwt

from app.auth.security import InvalidTokenError, create_access_token, decode_access_token
from app.core.config import get_settings


def test_create_access_token_embeds_the_subject_and_an_expiry():
    token = create_access_token(subject=42)

    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])

    assert payload["sub"] == "42"
    assert "exp" in payload


def test_decode_access_token_round_trips_a_valid_token():
    token = create_access_token(subject=42)

    user_id = decode_access_token(token)

    assert user_id == 42


def test_decode_access_token_raises_for_a_tampered_token():
    token = create_access_token(subject=42)
    tampered_token = token[:-1] + ("a" if token[-1] != "a" else "b")

    with pytest.raises(InvalidTokenError):
        decode_access_token(tampered_token)


def test_decode_access_token_raises_for_an_expired_token():
    settings = get_settings()
    expired_payload = {"sub": "42", "exp": datetime.now(timezone.utc) - timedelta(minutes=1)}
    expired_token = jwt.encode(expired_payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)

    with pytest.raises(InvalidTokenError):
        decode_access_token(expired_token)


def test_decode_access_token_raises_for_a_malformed_token():
    with pytest.raises(InvalidTokenError):
        decode_access_token("this-is-not-a-jwt")
