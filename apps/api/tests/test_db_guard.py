import pytest

from tests.db_guard import RemoteTestDatabaseError, assert_local_database


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg2://user:pw@localhost:5432/pm_test",
        "postgresql+psycopg2://user:pw@127.0.0.1/pm_test",
        "postgresql://user:pw@[::1]:5432/pm_test",
        "postgresql+psycopg2://user:pw@postgres:5432/pm_test",
    ],
)
def test_local_database_urls_are_allowed(url: str) -> None:
    assert_local_database(url, allow_remote=False)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg2://user:pw@ep-quiet-pine-123.ap-southeast-1.aws.neon.tech/neondb",
        "postgresql://user:pw@db.example.com:5432/prod",
    ],
)
def test_remote_database_urls_are_refused(url: str) -> None:
    with pytest.raises(RemoteTestDatabaseError, match="local database"):
        assert_local_database(url, allow_remote=False)


def test_remote_database_allowed_with_explicit_opt_in() -> None:
    assert_local_database("postgresql://user:pw@db.example.com/prod", allow_remote=True)


def test_error_message_does_not_leak_credentials() -> None:
    with pytest.raises(RemoteTestDatabaseError) as excinfo:
        assert_local_database("postgresql://alice:s3cret@db.example.com/prod", allow_remote=False)
    assert "s3cret" not in str(excinfo.value)
    assert "alice" not in str(excinfo.value)
