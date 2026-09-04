import base64
import os


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
