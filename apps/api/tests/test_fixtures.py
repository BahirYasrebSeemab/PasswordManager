from app.auth.models import User


def test_client_fixture_can_reach_the_health_endpoint(client):
    response = client.get("/health")

    assert response.status_code == 200


def test_db_session_fixture_can_query_the_users_table(db_session):
    users = db_session.query(User).filter(User.email == "nobody-should-exist@pytest.local").all()

    assert users == []
