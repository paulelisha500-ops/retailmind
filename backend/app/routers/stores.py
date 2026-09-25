from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Store, User
from app.schemas import StoreOut
from app.security import get_current_user

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("", response_model=list[StoreOut])
def list_stores(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Powers the Enterprise store picker for staff, and lets the customer
    app resolve which store to check out at — any signed-in user (employee
    or customer) can read the store list, not just staff."""
    return db.query(Store).order_by(Store.name).all()
