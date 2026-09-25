import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import AccessLevel, Store, User, UserRole
from app.schemas import TeamMemberCreate, TeamMemberOut
from app.security import hash_password, require_admin, require_employee

router = APIRouter(prefix="/team", tags=["team"])


@router.get("", response_model=list[TeamMemberOut])
def list_team(
    store_id: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_employee),
):
    """Any signed-in staff member can view the team; only Admin can edit it.
    Pass store_id to scope the list (this is what the Enterprise toggle in
    the frontend does — Single Store mode never sends store_id)."""
    q = db.query(User).filter(User.role == UserRole.employee)
    if store_id:
        q = q.filter(User.store_id == store_id)
    return q.all()


@router.post("", response_model=TeamMemberOut, status_code=201)
def add_team_member(
    payload: TeamMemberCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    if db.query(User).filter(func.lower(User.email) == payload.email).first():
        raise HTTPException(status_code=409, detail="A user with that email already exists")
    if not db.get(Store, payload.store_id):
        raise HTTPException(status_code=404, detail="Store not found")

    if payload.access_level not in [lvl.value for lvl in AccessLevel]:
        raise HTTPException(status_code=422, detail="access_level must be staff, manager, or admin")

    # New hires get a random temp password and a reset-link flow in production;
    # scaffolded here as a random secret rather than left blank.
    temp_password = secrets.token_urlsafe(9)

    member = User(
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(temp_password),
        role=UserRole.employee,
        department=payload.department,
        title=payload.title,
        access_level=AccessLevel(payload.access_level),
        responsibilities=payload.responsibilities,
        store_id=payload.store_id,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/{user_id}", status_code=204)
def remove_team_member(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    member = db.query(User).filter(User.id == user_id, User.role == UserRole.employee).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    if member.id == admin.id:
        raise HTTPException(status_code=409, detail="You can't remove your own account")
    if member.access_level == AccessLevel.admin and db.query(User).filter(User.role == UserRole.employee, User.access_level == AccessLevel.admin, User.id != member.id).count() == 0:
        raise HTTPException(status_code=409, detail="You can't remove the last admin")
    try:
        db.delete(member)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Can't remove this member — they have orders, tasks, or approvals on record")
