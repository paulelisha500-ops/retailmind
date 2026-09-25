import threading
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Store, User
from app.schemas import LoginRequest, TokenResponse, UserMeOut, UserPreferencesUpdate
from app.security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_FAILED_PER_EMAIL = 8
MAX_FAILED_PER_IP = 30
LOGIN_WINDOW_SECONDS = 15 * 60

# In-process sliding window — enough for the single-worker deployment this repo
# ships; a multi-worker deployment would move these counters into Redis.
_failed_logins: dict[str, list[float]] = defaultdict(list)
_failed_lock = threading.Lock()

# Verified against when the email is unknown so a miss costs the same bcrypt time as a wrong password.
_DUMMY_HASH = hash_password("not-a-real-password")


def _recent_failures(key: str, now: float) -> list[float]:
    recent = [t for t in _failed_logins[key] if now - t < LOGIN_WINDOW_SECONDS]
    _failed_logins[key] = recent
    return recent


def _login_keys(request: Request, email: str) -> list[tuple[str, int]]:
    ip = request.client.host if request.client else "unknown"
    return [(f"ip:{ip}", MAX_FAILED_PER_IP), (f"email:{email}", MAX_FAILED_PER_EMAIL)]


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Single login endpoint for both the customer and staff portals — the
    same split the app's login screen makes client-side, just enforced
    server-side too. `role` in the response tells the client which
    experience to route into."""
    keys = _login_keys(request, payload.email)
    now = time.time()
    with _failed_lock:
        for key, limit in keys:
            recent = _recent_failures(key, now)
            if len(recent) >= limit:
                retry_after = int(LOGIN_WINDOW_SECONDS - (now - recent[0])) + 1
                raise HTTPException(status_code=429, detail="Too many failed sign-in attempts. Try again in a few minutes.", headers={"Retry-After": str(retry_after)})

    user = db.query(User).filter(func.lower(User.email) == payload.email).first()
    password_ok = verify_password(payload.password, user.hashed_password if user else _DUMMY_HASH)
    if not user or not password_ok:
        with _failed_lock:
            for key, _ in keys:
                _failed_logins[key].append(now)
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    with _failed_lock:
        _failed_logins.pop(keys[1][0], None)

    token = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        role=user.role.value,
        access_level=user.access_level.value if user.access_level else None,
    )


@router.get("/me", response_model=UserMeOut)
def me(user: User = Depends(get_current_user)):
    """The client calls this right after login (and on reload, with a
    stored token) to get the profile info the token itself doesn't carry —
    name, title, store, responsibilities — everything the sidebar/greeting
    and RBAC-gated screens need."""
    return user


@router.patch("/me", response_model=UserMeOut)
def update_me(payload: UserPreferencesUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Self-service preferences from the Profile screen: a customer's
    preferred checkout store, and per-user notification toggles that
    actually filter what GET /notifications returns for this account."""
    changes = payload.model_dump(exclude_unset=True)
    store_id = changes.get("preferred_store_id")
    if store_id is not None and not db.get(Store, store_id):
        raise HTTPException(status_code=404, detail="Store not found")
    for field, value in changes.items():
        if value is None and field != "preferred_store_id":
            continue  # the notify_* toggles are NOT NULL booleans; null means "leave unchanged"
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user
