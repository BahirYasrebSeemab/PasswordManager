from app.auth.models import User
from app.security import hash_password
from app.vault.models import VaultEntry


def test_client_fixture_teardown_deletes_vault_entries_before_users(client, db_session):
    user = User(email="cleanup-check@pytest.local", hashed_password=hash_password("irrelevant"))
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    entry = VaultEntry(user_id=user.id, ciphertext="irrelevant-ciphertext")
    db_session.add(entry)
    db_session.commit()

    # The client fixture's teardown runs after this test function returns.
    # We can't observe it from inside the test, so this test's real job is
    # to exist as a canary: if teardown ordering is wrong, pytest reports
    # an ERROR (not a failure) on THIS test when its fixture teardown runs.
