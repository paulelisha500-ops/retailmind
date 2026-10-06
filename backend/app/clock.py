"""The one clock for the server edition.

Every DateTime column stores naive UTC, and every comparison in the routers expects it. datetime.utcnow() returns
exactly that but is deprecated and slated for removal, so the current time is read from here instead.
"""
from datetime import UTC, datetime


def utcnow() -> datetime:
    """The current time in UTC, without a timezone attached (as stored in the database)."""
    return datetime.now(UTC).replace(tzinfo=None)
