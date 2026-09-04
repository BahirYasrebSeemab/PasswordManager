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
