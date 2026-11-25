"""Stop the test suite from ever running against a real (remote) database.

The tests create and then delete users and vault entries. Pointed at the production
database by mistake (e.g. because `.env` holds the deployed DATABASE_URL), they would
write to and delete from real data. So the suite only runs against a local database
unless you explicitly opt in with ALLOW_REMOTE_TEST_DB=1.
"""

from sqlalchemy.engine import make_url

# "postgres" is the service name used by docker-compose / CI containers.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "postgres"})


class RemoteTestDatabaseError(RuntimeError):
    pass


def assert_local_database(database_url: str, *, allow_remote: bool) -> None:
    if allow_remote:
        return
    host = (make_url(database_url).host or "").strip("[]").lower()
    if host in LOCAL_HOSTS:
        return
    # Only the host goes in the message, never the username or password.
    raise RemoteTestDatabaseError(
        f"Refusing to run tests against '{host}': tests must use a local database. "
        "Set DATABASE_URL to a local Postgres (see README, 'Run the tests'), "
        "or set ALLOW_REMOTE_TEST_DB=1 if you really mean it."
    )
