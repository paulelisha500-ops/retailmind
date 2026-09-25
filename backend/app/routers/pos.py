"""
The staff-operated register: a customer directory (Modules named this
"customer details" — name/phone/loyalty, the same lookup a LuLu or Carrefour
cashier does by asking "what's your number please") plus a cashier checkout
that rings up a fresh cart against real stock and records which tender type
was used — cash, card, a digital wallet, or a buy-now-pay-later provider —
the same bucket a real POS till's Z-report groups sales into.

This never touches a card network, wallet, or BNPL provider: no card
numbers, no payment credentials are collected anywhere here. Selecting
"Card" just records that the physical terminal (outside this system, like
every real POS) settled the payment — exactly like a till log's tender-type
column. The only real money-like state this software owns is loyalty
points, which it earns/redeems as a straightforward integer ledger on the
User row.
"""
import re
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.constants import POINTS_TO_AED
from app.database import get_db
from app.models import CustomerOrder, CustomerOrderItem, Product, Store, User, UserRole
from app.schemas import (
    PAYMENT_METHODS, CashierCheckoutRequest, CustomerDetailOut, CustomerDirectoryOut,
    CustomerOrderOut, QuickCustomerCreate,
)
from app.security import hash_password, require_employee
from app.services.fulfillment import consume_stock, record_stock_shortfall

router = APIRouter(prefix="/pos", tags=["pos"])


def _order_stats(db: Session, customer_ids: list[str]) -> dict[str, tuple[int, datetime | None]]:
    if not customer_ids:
        return {}
    rows = (
        db.query(CustomerOrder.customer_id, func.count(CustomerOrder.id), func.max(CustomerOrder.created_at))
        .filter(CustomerOrder.customer_id.in_(customer_ids))
        .group_by(CustomerOrder.customer_id)
        .all()
    )
    return {cid: (count, last) for cid, count, last in rows}


def _directory_row(user: User, stats: dict) -> CustomerDirectoryOut:
    count, last = stats.get(user.id, (0, None))
    return CustomerDirectoryOut(
        id=user.id, name=user.name, phone=user.phone, email=user.email,
        loyalty_points=user.loyalty_points or 0, member_since=user.created_at,
        total_orders=count, last_order_at=last,
    )


@router.get("/customers", response_model=list[CustomerDirectoryOut])
def search_customers(search: str | None = None, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """Register-side lookup: search by name, phone or email. No query
    returns the most recently active accounts first, capped at 50 — a real
    till doesn't dump the entire customer base onto one screen."""
    q = db.query(User).filter(User.role == UserRole.customer)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter((User.name.ilike(term)) | (User.phone.ilike(term)) | (User.email.ilike(term)))
    users = q.order_by(User.created_at.desc()).limit(50).all()
    stats = _order_stats(db, [u.id for u in users])
    return [_directory_row(u, stats) for u in users]


@router.get("/customers/{customer_id}", response_model=CustomerDetailOut)
def get_customer(customer_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    user = db.query(User).filter(User.id == customer_id, User.role == UserRole.customer).first()
    if not user:
        raise HTTPException(status_code=404, detail="Customer not found")
    stats = _order_stats(db, [user.id])
    orders = (
        db.query(CustomerOrder)
        .filter(CustomerOrder.customer_id == user.id)
        .order_by(CustomerOrder.created_at.desc())
        .limit(20)
        .all()
    )
    base = _directory_row(user, stats)
    return CustomerDetailOut(**base.model_dump(), orders=orders)


@router.post("/customers", response_model=CustomerDetailOut, status_code=201)
def quick_enroll_customer(payload: QuickCustomerCreate, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """Register-side loyalty sign-up — name + phone number, like the
    30-second enrollment a LuLu or Carrefour cashier runs at checkout. If
    that phone is already on file, returns the existing account instead of
    creating a duplicate (a cashier asking for "your number" is really
    asking "have we seen you before")."""
    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(status_code=422, detail="Phone number is required")

    existing = db.query(User).filter(User.phone == phone).first()
    if existing:
        if existing.role != UserRole.customer:
            raise HTTPException(status_code=409, detail="This number belongs to a staff account, not a customer")
        stats = _order_stats(db, [existing.id])
        orders = db.query(CustomerOrder).filter(CustomerOrder.customer_id == existing.id).order_by(CustomerOrder.created_at.desc()).limit(20).all()
        return CustomerDetailOut(**_directory_row(existing, stats).model_dump(), orders=orders)

    email = payload.email or f"cust{re.sub(r'[^0-9]', '', phone)}@loyalty.retailmind.local"
    if db.query(User).filter(func.lower(User.email) == email.lower()).first():
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    user = User(
        name=payload.name.strip() or "Guest", email=email, phone=phone,
        hashed_password=hash_password(secrets.token_urlsafe(24)),  # enrolled in-store; no app login until they set one up
        role=UserRole.customer, loyalty_points=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return CustomerDetailOut(**_directory_row(user, {}).model_dump(), orders=[])


@router.post("/checkout", response_model=CustomerOrderOut, status_code=201)
def cashier_checkout(payload: CashierCheckoutRequest, db: Session = Depends(get_db), user: User = Depends(require_employee)):
    """The register sale: cashier builds a fresh cart (not the shopper's own
    shopping list), optionally attaches a loyalty account, optionally
    redeems points, picks a tender type, and completes the sale — decrementing
    real stock the same way self-checkout does, so shelf-fill and
    reorder-needed stay honest regardless of which till rang the item up."""
    if payload.payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=422, detail=f"payment_method must be one of {', '.join(PAYMENT_METHODS)}")
    if not payload.items:
        raise HTTPException(status_code=422, detail="Cart is empty")
    if not db.get(Store, payload.store_id):
        raise HTTPException(status_code=404, detail="Store not found")

    resolved: list[tuple[Product, int]] = []
    for line in payload.items:
        if line.quantity <= 0:
            raise HTTPException(status_code=422, detail="Item quantity must be at least 1")
        product = db.query(Product).filter(Product.id == line.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {line.product_id} not found")
        resolved.append((product, line.quantity))

    customer = None
    if payload.customer_id:
        customer = db.query(User).filter(User.id == payload.customer_id, User.role == UserRole.customer).with_for_update().first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")

    subtotal = sum(p.price * qty for p, qty in resolved)

    points_to_redeem = max(0, payload.points_to_redeem)
    if points_to_redeem and not customer:
        raise HTTPException(status_code=422, detail="Attach a customer to redeem loyalty points")
    if customer and points_to_redeem > (customer.loyalty_points or 0):
        raise HTTPException(status_code=422, detail=f"{customer.name} only has {customer.loyalty_points or 0} points available")
    max_usable_points = int(subtotal / POINTS_TO_AED)
    points_to_redeem = min(points_to_redeem, max_usable_points)
    discount = round(points_to_redeem * POINTS_TO_AED, 2)

    total = round(max(0.0, subtotal - discount), 2)

    if payload.payment_method == "cash":
        if payload.amount_tendered is None or payload.amount_tendered < total:
            raise HTTPException(status_code=422, detail="Amount tendered is less than the total due")
        amount_tendered = round(payload.amount_tendered, 2)
        change_due = round(amount_tendered - total, 2)
    else:
        amount_tendered = total
        change_due = 0.0

    order = CustomerOrder(
        customer_id=customer.id if customer else None, store_id=payload.store_id, total=total,
        channel="cashier", cashier_id=user.id, payment_method=payload.payment_method,
        amount_tendered=amount_tendered, change_due=change_due, points_redeemed=points_to_redeem,
    )
    db.add(order)
    db.flush()

    for product, qty in resolved:
        db.add(CustomerOrderItem(order_id=order.id, product_id=product.id, quantity=qty, unit_price=product.price))
        taken = consume_stock(db, payload.store_id, product.id, qty)
        if taken < qty:
            record_stock_shortfall(db, payload.store_id, product.name, qty, taken)

    points_earned = int(total) if customer else 0
    order.loyalty_points_earned = points_earned
    if customer:
        customer.loyalty_points = (customer.loyalty_points or 0) - points_to_redeem + points_earned

    db.commit()
    db.refresh(order)
    return order
