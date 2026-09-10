from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.auth.models import User
from app.db.session import SessionLocal, get_db
from app.main import app
from app.vault.models import VaultEntry


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

    test_user_ids = db_session.scalars(select(User.id).where(User.email.like("%@pytest.local"))).all()
    if test_user_ids:
        db_session.execute(delete(VaultEntry).where(VaultEntry.user_id.in_(test_user_ids)))
    db_session.query(User).filter(User.email.like("%@pytest.local")).delete(synchronize_session=False)
    db_session.commit()


@pytest.fixture(autouse=True)
def reset_rate_limiter() -> None:
    app.state.limiter.reset()
