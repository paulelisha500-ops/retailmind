import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import (
    AccessLevel,
    Alert,
    CustomerOrder,
    PurchaseOrder,
    ShoppingListItem,
    Store,
    SupplierContactLog,
    Task,
    User,
    UserRole,
)
from app.schemas import TeamMemberCreate, TeamMemberCreatedOut, TeamMemberOut
from app.security import hash_password, require_admin, require_employee

router = APIRouter(prefix="/team", tags=["team"])


def has_history(db: Session, user_id: str) -> bool:
    """Rows other tables point at: removing the member would orphan orders, tasks, alerts or approvals. Checked
    here rather than left to the database so every engine (SQLite doesn't enforce foreign keys) answers the same."""
    return any(
        db.query(query.exists()).scalar()
        for query in (
            db.query(Task).filter(Task.assigned_to == user_id),
            db.query(Alert).filter(Alert.assigned_to == user_id),
            db.query(CustomerOrder).filter((CustomerOrder.cashier_id == user_id) | (CustomerOrder.customer_id == user_id)),
            db.query(PurchaseOrder).filter(PurchaseOrder.approved_by == user_id),
            db.query(SupplierContactLog).filter(SupplierContactLog.triggered_by == user_id),
            db.query(ShoppingListItem).filter(ShoppingListItem.customer_id == user_id),
        )
    )


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


@router.post("", response_model=TeamMemberCreatedOut, status_code=201)
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

    # A new hire gets a one-time temporary password. It is returned in this response and never stored in the clear
    # or shown again, so the admin can hand it over.
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
    return TeamMemberCreatedOut.model_validate({**TeamMemberOut.model_validate(member).model_dump(), "temporary_password": temp_password})


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
    history_error = HTTPException(status_code=409, detail="Can't remove this member — they have orders, tasks, or approvals on record")
    if has_history(db, member.id):
        raise history_error
    try:
        db.delete(member)
        db.commit()
    except IntegrityError as exc:  # a reference the check above doesn't know about (Postgres enforces it)
        db.rollback()
        raise history_error from exc
