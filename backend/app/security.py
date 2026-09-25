"""
Password hashing, JWT issuing/verification, and the RBAC dependencies used
to gate routes the same way the frontend prototype gates screens:
  - `require_employee`     — any signed-in staff member
  - `require_responsibility("Purchase Approvals")` — must be Admin OR have
    that specific responsibility assigned in Team & Access
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import AccessLevel, User, UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)


def verify_password(raw: str, hashed: str) -> bool:
    return pwd_context.verify(raw, hashed)


def create_access_token(user_id: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": user_id, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise credentials_error
    except JWTError:
        raise credentials_error

    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_error
    return user


def require_employee(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.employee:
        raise HTTPException(status_code=403, detail="Staff access required")
    return user


def require_customer(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.customer:
        raise HTTPException(status_code=403, detail="Customer account required")
    return user


def require_admin(user: User = Depends(require_employee)) -> User:
    if user.access_level != AccessLevel.admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_responsibility(name: str):
    """Factory: e.g. Depends(require_responsibility('Purchase Approvals')).
    Admins always pass; everyone else needs the specific responsibility
    assigned to them in Team & Access."""

    def _check(user: User = Depends(require_employee)) -> User:
        if not user.has_responsibility(name):
            raise HTTPException(status_code=403, detail=f"Requires the '{name}' responsibility")
        return user

    return _check
