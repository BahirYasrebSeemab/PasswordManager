def _register_and_get_token(client, email: str) -> str:
    response = client.post(
        "/auth/register",
        json={"email": email, "auth_key": "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE="},
    )
    assert response.status_code == 201
    return response.json()["access_token"]


def test_create_vault_entry_returns_201_with_entry(client):
    token = _register_and_get_token(client, "vault-create@pytest.local")

    response = client.post(
        "/vault",
        json={"ciphertext": "c2FtcGxlLWNpcGhlcnRleHQ="},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["ciphertext"] == "c2FtcGxlLWNpcGhlcnRleHQ="
    assert "id" in body
    assert "created_at" in body
    assert "updated_at" in body


def test_create_vault_entry_without_token_returns_401(client):
    response = client.post("/vault", json={"ciphertext": "c2FtcGxlLWNpcGhlcnRleHQ="})
    assert response.status_code == 401


def test_create_vault_entry_rejects_empty_ciphertext(client):
    token = _register_and_get_token(client, "vault-create-empty@pytest.local")

    response = client.post(
        "/vault",
        json={"ciphertext": ""},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422


def test_list_vault_entries_returns_only_callers_own_entries(client):
    token_a = _register_and_get_token(client, "vault-list-a@pytest.local")
    token_b = _register_and_get_token(client, "vault-list-b@pytest.local")

    client.post("/vault", json={"ciphertext": "entry-a-1"}, headers={"Authorization": f"Bearer {token_a}"})
    client.post("/vault", json={"ciphertext": "entry-a-2"}, headers={"Authorization": f"Bearer {token_a}"})
    client.post("/vault", json={"ciphertext": "entry-b-1"}, headers={"Authorization": f"Bearer {token_b}"})

    response = client.get("/vault", headers={"Authorization": f"Bearer {token_a}"})

    assert response.status_code == 200
    ciphertexts = [entry["ciphertext"] for entry in response.json()]
    assert set(ciphertexts) == {"entry-a-1", "entry-a-2"}


def test_list_vault_entries_returns_newest_first(client):
    token = _register_and_get_token(client, "vault-list-order@pytest.local")

    client.post("/vault", json={"ciphertext": "first-created"}, headers={"Authorization": f"Bearer {token}"})
    client.post("/vault", json={"ciphertext": "second-created"}, headers={"Authorization": f"Bearer {token}"})

    response = client.get("/vault", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    ciphertexts = [entry["ciphertext"] for entry in response.json()]
    assert ciphertexts == ["second-created", "first-created"]


def test_list_vault_entries_without_token_returns_401(client):
    response = client.get("/vault")
    assert response.status_code == 401


def test_get_vault_entry_returns_own_entry(client):
    token = _register_and_get_token(client, "vault-get-own@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "get-me"}, headers={"Authorization": f"Bearer {token}"}
    )
    entry_id = create_response.json()["id"]

    response = client.get(f"/vault/{entry_id}", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["ciphertext"] == "get-me"


def test_get_vault_entry_for_nonexistent_id_returns_404(client):
    token = _register_and_get_token(client, "vault-get-missing@pytest.local")

    response = client.get("/vault/999999999", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 404


def test_get_vault_entry_owned_by_another_user_returns_404(client):
    token_owner = _register_and_get_token(client, "vault-get-owner@pytest.local")
    token_other = _register_and_get_token(client, "vault-get-other@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "not-yours"}, headers={"Authorization": f"Bearer {token_owner}"}
    )
    entry_id = create_response.json()["id"]

    response = client.get(f"/vault/{entry_id}", headers={"Authorization": f"Bearer {token_other}"})

    assert response.status_code == 404


def test_get_vault_entry_nonexistent_and_not_owned_return_identical_body(client):
    token_owner = _register_and_get_token(client, "vault-get-identical-owner@pytest.local")
    token_other = _register_and_get_token(client, "vault-get-identical-other@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "irrelevant"}, headers={"Authorization": f"Bearer {token_owner}"}
    )
    entry_id = create_response.json()["id"]

    not_owned_response = client.get(f"/vault/{entry_id}", headers={"Authorization": f"Bearer {token_other}"})
    nonexistent_response = client.get("/vault/999999999", headers={"Authorization": f"Bearer {token_other}"})

    assert not_owned_response.status_code == nonexistent_response.status_code == 404
    assert not_owned_response.json() == nonexistent_response.json()


def test_get_vault_entry_without_token_returns_401(client):
    response = client.get("/vault/1")
    assert response.status_code == 401


def test_update_vault_entry_replaces_ciphertext_and_advances_updated_at(client):
    token = _register_and_get_token(client, "vault-update-own@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "old-value"}, headers={"Authorization": f"Bearer {token}"}
    )
    entry_id = create_response.json()["id"]
    original_updated_at = create_response.json()["updated_at"]

    response = client.put(
        f"/vault/{entry_id}",
        json={"ciphertext": "new-value"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ciphertext"] == "new-value"
    assert body["updated_at"] >= original_updated_at


def test_update_vault_entry_owned_by_another_user_returns_404(client):
    token_owner = _register_and_get_token(client, "vault-update-owner@pytest.local")
    token_other = _register_and_get_token(client, "vault-update-other@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "not-yours"}, headers={"Authorization": f"Bearer {token_owner}"}
    )
    entry_id = create_response.json()["id"]

    response = client.put(
        f"/vault/{entry_id}",
        json={"ciphertext": "hijacked"},
        headers={"Authorization": f"Bearer {token_other}"},
    )

    assert response.status_code == 404


def test_update_vault_entry_nonexistent_returns_404(client):
    token = _register_and_get_token(client, "vault-update-missing@pytest.local")

    response = client.put(
        "/vault/999999999",
        json={"ciphertext": "irrelevant"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 404


def test_update_vault_entry_rejects_empty_ciphertext(client):
    token = _register_and_get_token(client, "vault-update-empty@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "old-value"}, headers={"Authorization": f"Bearer {token}"}
    )
    entry_id = create_response.json()["id"]

    response = client.put(
        f"/vault/{entry_id}",
        json={"ciphertext": ""},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422


def test_update_vault_entry_without_token_returns_401(client):
    response = client.put("/vault/1", json={"ciphertext": "irrelevant"})
    assert response.status_code == 401


def test_delete_vault_entry_removes_it(client):
    token = _register_and_get_token(client, "vault-delete-own@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "delete-me"}, headers={"Authorization": f"Bearer {token}"}
    )
    entry_id = create_response.json()["id"]

    delete_response = client.delete(f"/vault/{entry_id}", headers={"Authorization": f"Bearer {token}"})
    assert delete_response.status_code == 204

    get_response = client.get(f"/vault/{entry_id}", headers={"Authorization": f"Bearer {token}"})
    assert get_response.status_code == 404


def test_delete_vault_entry_owned_by_another_user_returns_404(client):
    token_owner = _register_and_get_token(client, "vault-delete-owner@pytest.local")
    token_other = _register_and_get_token(client, "vault-delete-other@pytest.local")
    create_response = client.post(
        "/vault", json={"ciphertext": "not-yours"}, headers={"Authorization": f"Bearer {token_owner}"}
    )
    entry_id = create_response.json()["id"]

    response = client.delete(f"/vault/{entry_id}", headers={"Authorization": f"Bearer {token_other}"})

    assert response.status_code == 404

    still_there = client.get(f"/vault/{entry_id}", headers={"Authorization": f"Bearer {token_owner}"})
    assert still_there.status_code == 200


def test_delete_vault_entry_nonexistent_returns_404(client):
    token = _register_and_get_token(client, "vault-delete-missing@pytest.local")

    response = client.delete("/vault/999999999", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 404


def test_delete_vault_entry_without_token_returns_401(client):
    response = client.delete("/vault/1")
    assert response.status_code == 401


def test_create_vault_entry_validation_error_does_not_echo_ciphertext(client):
    token = _register_and_get_token(client, "vault-noecho@pytest.local")
    secret = "plaintext-that-should-never-be-reflected"

    response = client.post(
        "/vault",
        json={"ciphertext": {"leak": secret}},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 422
    assert secret not in response.text


def test_create_vault_entry_is_rate_limited_after_thirty_attempts_per_minute(client):
    token = _register_and_get_token(client, "vault-ratelimit-create@pytest.local")

    for _ in range(30):
        client.post(
            "/vault", json={"ciphertext": "spam"}, headers={"Authorization": f"Bearer {token}"}
        )

    response = client.post(
        "/vault", json={"ciphertext": "spam"}, headers={"Authorization": f"Bearer {token}"}
    )

    assert response.status_code == 429


def test_list_vault_entries_is_rate_limited_after_sixty_attempts_per_minute(client):
    token = _register_and_get_token(client, "vault-ratelimit-list@pytest.local")

    for _ in range(60):
        client.get("/vault", headers={"Authorization": f"Bearer {token}"})

    response = client.get("/vault", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 429


def test_get_vault_entry_is_rate_limited_after_sixty_attempts_per_minute(client):
    token = _register_and_get_token(client, "vault-ratelimit-get@pytest.local")

    for _ in range(60):
        client.get("/vault/999999999", headers={"Authorization": f"Bearer {token}"})

    response = client.get("/vault/999999999", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 429


def test_update_vault_entry_is_rate_limited_after_thirty_attempts_per_minute(client):
    token = _register_and_get_token(client, "vault-ratelimit-update@pytest.local")

    for _ in range(30):
        client.put(
            "/vault/999999999",
            json={"ciphertext": "spam"},
            headers={"Authorization": f"Bearer {token}"},
        )

    response = client.put(
        "/vault/999999999",
        json={"ciphertext": "spam"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 429


def test_delete_vault_entry_is_rate_limited_after_thirty_attempts_per_minute(client):
    token = _register_and_get_token(client, "vault-ratelimit-delete@pytest.local")

    for _ in range(30):
        client.delete("/vault/999999999", headers={"Authorization": f"Bearer {token}"})

    response = client.delete("/vault/999999999", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 429
