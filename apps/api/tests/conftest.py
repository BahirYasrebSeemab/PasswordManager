from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.auth.models import User
from app.db.session import SessionLocal, get_db
from app.main import app


@pytest.fixture
def db_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session: Session) -> Generator[TestClient, None, None]:
    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    yield TestClient(app)

    app.dependency_overrides.clear()
    db_session.query(User).filter(User.email.like("%@pytest.local")).delete(synchronize_session=False)
    db_session.commit()


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> None:
    app.state.limiter.reset()
