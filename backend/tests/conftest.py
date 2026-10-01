"""
Test harness: the real FastAPI app on a throwaway database, with the same starting workspace the browser edition uses
(app.seed). By default that is a SQLite file, re-created per test from a seeded template (milliseconds). Set
TEST_DATABASE_URL to a PostgreSQL URL to run the identical suite against the server edition's real database: the
seeded workspace is built once into a template database and every test gets a fresh copy of it. The forecasting
libraries are optional; tests that need one skip when it isn't installed.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Settings are read once, at import, so the environment is arranged before the app is imported.
_TMP = tempfile.mkdtemp(prefix="retailmind-tests-")
_LIVE = Path(_TMP, "test.db")
_TEMPLATE = Path(_TMP, "seeded.db")
_POSTGRES = os.environ.get("TEST_DATABASE_URL", "").startswith("postgres")
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"] if _POSTGRES else f"sqlite:///{_LIVE.as_posix()}"
os.environ["JWT_SECRET"] = "test-secret-not-used-anywhere-else-0123456789"
os.environ["ENVIRONMENT"] = "test"
os.environ["ALLOW_WORKSPACE_RESET"] = "true"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.engine import make_url  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import seed  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Store, User  # noqa: E402

PASSWORD = seed.SEED_PASSWORD
ACCOUNTS = {
    "admin": "marcus@retailmind.app",
    "manager": "priya@retailmind.app",
    "staff": "diego@retailmind.app",
    "inspector": "aisha@retailmind.app",
    "riverside": "hana@retailmind.app",
    "customer": "layla@members.retailmind.app",
}


def _pg_recreate(name: str, template: str | None = None) -> None:
    """(Re)creates a PostgreSQL database, optionally as a copy of another one (nothing may be connected to either)."""
    admin = create_engine(make_url(os.environ["DATABASE_URL"]).set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{name}"' + (f' TEMPLATE "{template}"' if template else "")))
    admin.dispose()


_PG_NAME = make_url(os.environ["DATABASE_URL"]).database if _POSTGRES else ""
_PG_TEMPLATE = f"{_PG_NAME}_template"


@pytest.fixture(scope="session", autouse=True)
def _seeded_template():
    """Seeds once, then keeps the finished database to copy from (a file for SQLite, a template for PostgreSQL)."""
    if _POSTGRES:
        _pg_recreate(_PG_TEMPLATE)
        seed_engine = create_engine(make_url(os.environ["DATABASE_URL"]).set(database=_PG_TEMPLATE))
        Base.metadata.create_all(bind=seed_engine)
        session = sessionmaker(bind=seed_engine)()
        seed.populate(session)
        session.close()
        seed_engine.dispose()
        yield
        engine.dispose()
        return
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    seed.populate(session)
    session.close()
    engine.dispose()
    shutil.copyfile(_LIVE, _TEMPLATE)
    yield
    engine.dispose()


@pytest.fixture()
def db():
    """A fresh seeded workspace for every test (a copy of the template, so it costs milliseconds)."""
    engine.dispose()
    if _POSTGRES:
        _pg_recreate(_PG_NAME, _PG_TEMPLATE)
    else:
        shutil.copyfile(_TEMPLATE, _LIVE)
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture()
def client(db):
    with TestClient(app) as test_client:
        yield test_client


class Api:
    """A small helper: sign in as a named account once, then call routes as that account."""

    def __init__(self, client: TestClient):
        self.client = client
        self._tokens: dict[str, str] = {}

    def token(self, who: str) -> str:
        email = ACCOUNTS.get(who, who)
        if email not in self._tokens:
            response = self.client.post("/auth/login", json={"email": email, "password": PASSWORD})
            assert response.status_code == 200, response.text
            self._tokens[email] = response.json()["access_token"]
        return self._tokens[email]

    def headers(self, who: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token(who)}"}

    def call(self, method: str, path: str, who: str | None = None, **kwargs):
        headers = kwargs.pop("headers", None) or (self.headers(who) if who else {})
        return self.client.request(method, path, headers=headers, **kwargs)

    def get(self, path, who=None, **kw):
        return self.call("GET", path, who, **kw)

    def post(self, path, who=None, **kw):
        return self.call("POST", path, who, **kw)

    def patch(self, path, who=None, **kw):
        return self.call("PATCH", path, who, **kw)

    def delete(self, path, who=None, **kw):
        return self.call("DELETE", path, who, **kw)


@pytest.fixture()
def api(client):
    return Api(client)


@pytest.fixture()
def hq(db) -> Store:
    return db.query(Store).filter(Store.is_headquarters == True).one()  # noqa: E712


def user_by_email(db, email: str) -> User:
    return db.query(User).filter(User.email == email).one()
