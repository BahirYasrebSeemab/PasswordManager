import base64

import pytest
from pydantic import ValidationError

from app.auth.schemas import LoginRequest, RegisterRequest

VALID_AUTH_KEY = base64.b64encode(b"0" * 32).decode()


def test_register_request_accepts_a_valid_auth_key():
    request = RegisterRequest(email="alice@example.com", auth_key=VALID_AUTH_KEY)

    assert request.auth_key == VALID_AUTH_KEY


def test_register_request_normalizes_email_to_lowercase_and_trimmed():
    request = RegisterRequest(email="  Alice@Example.com  ", auth_key=VALID_AUTH_KEY)

    assert request.email == "alice@example.com"


def test_register_request_rejects_an_auth_key_of_the_wrong_length():
    short_key = base64.b64encode(b"0" * 16).decode()

    with pytest.raises(ValidationError):
        RegisterRequest(email="alice@example.com", auth_key=short_key)


def test_register_request_rejects_an_auth_key_that_is_not_valid_base64():
    with pytest.raises(ValidationError):
        RegisterRequest(email="alice@example.com", auth_key="not-valid-base64!!!")


def test_register_request_rejects_an_email_without_an_at_symbol():
    with pytest.raises(ValidationError):
        RegisterRequest(email="not-an-email", auth_key=VALID_AUTH_KEY)


def test_login_request_applies_the_same_validation_as_register_request():
    with pytest.raises(ValidationError):
        LoginRequest(email="not-an-email", auth_key=VALID_AUTH_KEY)


def test_register_request_rejects_a_non_ascii_email():
    with pytest.raises(ValidationError):
        RegisterRequest(email="café@example.com", auth_key=VALID_AUTH_KEY)
