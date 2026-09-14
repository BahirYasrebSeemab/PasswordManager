import base64
import os

from sqlalchemy import select

from app.auth.models import User
from app.vault.models import VaultEntry


def _random_auth_key() -> str:
    return base64.b64encode(os.urandom(32)).decode()


def test_register_creates_a_user_and_returns_a_token(client):
    response = client.post(
        "/auth/register",
        json={"email": "alice@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 201
    body = response.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


def test_register_rejects_a_duplicate_email(client):
    auth_key = _random_auth_key()
    client.post("/auth/register", json={"email": "bob@pytest.local", "auth_key": auth_key})

    response = client.post(
        "/auth/register",
        json={"email": "bob@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Email already registered"}


def test_login_succeeds_with_the_correct_auth_key(client):
    auth_key = _random_auth_key()
    client.post("/auth/register", json={"email": "carol@pytest.local", "auth_key": auth_key})

    response = client.post(
        "/auth/login",
        json={"email": "carol@pytest.local", "auth_key": auth_key},
    )

    assert response.status_code == 200
    assert "access_token" in response.json()


def test_login_fails_with_the_wrong_auth_key(client):
    client.post(
        "/auth/register",
        json={"email": "dave@pytest.local", "auth_key": _random_auth_key()},
    )

    response = client.post(
        "/auth/login",
        json={"email": "dave@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_login_fails_for_a_nonexistent_email_with_the_same_generic_error(client):
    response = client.post(
        "/auth/login",
        json={"email": "nobody@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid email or password"}


def test_login_is_rate_limited_after_five_attempts_per_minute(client):
    for _ in range(5):
        client.post(
            "/auth/login",
            json={"email": "nobody@pytest.local", "auth_key": _random_auth_key()},
        )

    response = client.post(
        "/auth/login",
        json={"email": "nobody@pytest.local", "auth_key": _random_auth_key()},
    )

    assert response.status_code == 429


def test_me_returns_the_current_user_for_a_valid_token(client):
    register_response = client.post(
        "/auth/register",
        json={"email": "erin@pytest.local", "auth_key": _random_auth_key()},
    )
    token = register_response.json()["access_token"]

    response = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "erin@pytest.local"
    assert "hashed_password" not in response.json()


def test_me_rejects_a_request_with_no_token(client):
    response = client.get("/auth/me")

    assert response.status_code == 401


def test_me_rejects_an_invalid_token(client):
    response = client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"})

    assert response.status_code == 401


def test_register_validation_error_does_not_echo_the_rejected_auth_key(client):
    rejected_auth_key = "hunter2-my-actual-master-password"

    response = client.post(
        "/auth/register",
        json={"email": "frank@pytest.local", "auth_key": rejected_auth_key},
    )

    assert response.status_code == 422
    assert rejected_auth_key not in response.text


def test_delete_account_removes_the_user_and_their_vault_entries(client, db_session):
    auth_key = _random_auth_key()
    register_response = client.post("/auth/register", json={"email": "gina@pytest.local", "auth_key": auth_key})
    token = register_response.json()["access_token"]
    client.post("/vault", json={"ciphertext": "irrelevant-ciphertext"}, headers={"Authorization": f"Bearer {token}"})
    user_id = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["id"]

    response = client.request("DELETE", "/auth/me", json={"auth_key": auth_key}, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 204
    assert db_session.get(User, user_id) is None
    assert db_session.scalars(select(VaultEntry).where(VaultEntry.user_id == user_id)).first() is None


def test_delete_account_fails_with_the_wrong_auth_key(client, db_session):
    auth_key = _random_auth_key()
    register_response = client.post("/auth/register", json={"email": "henry@pytest.local", "auth_key": auth_key})
    token = register_response.json()["access_token"]
    user_id = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()["id"]

    response = client.request(
        "DELETE", "/auth/me", json={"auth_key": _random_auth_key()}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 401
    assert db_session.get(User, user_id) is not None


def test_delete_account_requires_a_valid_token(client):
    response = client.request("DELETE", "/auth/me", json={"auth_key": _random_auth_key()})

    assert response.status_code == 401


def test_delete_account_is_rate_limited_after_five_attempts_per_minute(client):
    auth_key = _random_auth_key()
    register_response = client.post("/auth/register", json={"email": "ivan@pytest.local", "auth_key": auth_key})
    token = register_response.json()["access_token"]

    for _ in range(5):
        client.request(
            "DELETE", "/auth/me", json={"auth_key": _random_auth_key()}, headers={"Authorization": f"Bearer {token}"}
        )

    response = client.request(
        "DELETE", "/auth/me", json={"auth_key": _random_auth_key()}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 429
