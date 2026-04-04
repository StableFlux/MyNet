"""
Shared fixtures for MyNet backend tests.
Uses an in-memory SQLite DB — never touches the real data file.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from database import Base
import models  # noqa: F401 — registers all models with Base


@pytest.fixture(scope="function")
def db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)


@pytest.fixture(scope="function")
def app_client(db):
    """TestClient wired to an in-memory DB with auth bypassed."""
    import os
    os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

    from main import app
    from database import get_db

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client
    app.dependency_overrides.clear()
