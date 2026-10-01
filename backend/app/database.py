"""
SQLAlchemy engine and session management.

The system of record: SKU master data, batch/lot expiry records, suppliers, purchase orders, orders and the team.
Free-form product attributes (nutrition, allergens) are JSON columns on the product row. It is a local SQLite file
unless DATABASE_URL names a PostgreSQL server, and the two behave the same.
"""
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)

if engine.dialect.name == "sqlite":

    @event.listens_for(engine, "connect")
    def _enforce_foreign_keys(dbapi_connection, _record):
        # SQLite only honours foreign keys when asked; PostgreSQL always does. Ask, so both refuse the same writes.
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
