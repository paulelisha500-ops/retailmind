"""
SQLAlchemy engine + session management.

Uses PostgreSQL as the system of record for anything transactional: SKU
master data, batch/lot expiry records, suppliers, purchase orders and
employees/IAM. Product attributes that don't fit a rigid schema well
(nutrition panels, per-supplier spec sheets) are intentionally NOT modeled
here — in production those live in MongoDB and are joined in the API layer
by product_id.
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

Base = declarative_base()


def get_db():
    """FastAPI dependency that yields a request-scoped DB session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
