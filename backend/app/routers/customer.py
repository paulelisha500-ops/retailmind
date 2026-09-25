"""
Customer-facing endpoints (Modules 10/12): product browsing/scan, shopping
list, checkout → digital receipts + loyalty points, offers, and a real (if
simple) recommendation engine computed from actual order history rather
than a fixed demo list.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CustomerOrder, CustomerOrderItem, Offer, Product, ShoppingListItem, Store, User
from app.schemas import (
    CheckoutRequest, CustomerOrderOut, OfferOut, ProductOut, RecommendationOut,
    ShoppingListItemCreate, ShoppingListItemOut, ShoppingListItemUpdate,
)
from app.security import require_customer
from app.services.fulfillment import consume_stock, record_stock_shortfall

router = APIRouter(prefix="/customer", tags=["customer"])


@router.get("/products", response_model=list[ProductOut])
def browse_products(
    category: str | None = None,
    search: str | None = None,
    barcode: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_customer),
):
    """Powers catalog browsing and the barcode scanner — pass `barcode` for
    a scan lookup, `search` for the name-search box, `category` to filter."""
    q = db.query(Product)
    if category:
        q = q.filter(Product.category == category)
    if barcode:
        q = q.filter(Product.barcode == barcode)
    if search:
        q = q.filter(Product.name.ilike(f"%{search}%"))
    return q.order_by(Product.name).all()


@router.get("/shopping-list", response_model=list[ShoppingListItemOut])
def get_shopping_list(db: Session = Depends(get_db), user: User = Depends(require_customer)):
    return (
        db.query(ShoppingListItem)
        .filter(ShoppingListItem.customer_id == user.id)
        .order_by(ShoppingListItem.added_at.desc())
        .all()
    )


@router.post("/shopping-list", response_model=ShoppingListItemOut, status_code=201)
def add_to_shopping_list(payload: ShoppingListItemCreate, db: Session = Depends(get_db), user: User = Depends(require_customer)):
    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    existing = (
        db.query(ShoppingListItem)
        .filter(ShoppingListItem.customer_id == user.id, ShoppingListItem.product_id == payload.product_id, ShoppingListItem.checked == False)  # noqa: E712
        .first()
    )
    if existing:
        existing.quantity = min(999, existing.quantity + payload.quantity)
        db.commit()
        db.refresh(existing)
        return existing

    item = ShoppingListItem(customer_id=user.id, product_id=payload.product_id, quantity=payload.quantity)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/shopping-list/{item_id}", response_model=ShoppingListItemOut)
def update_shopping_list_item(item_id: str, payload: ShoppingListItemUpdate, db: Session = Depends(get_db), user: User = Depends(require_customer)):
    item = db.query(ShoppingListItem).filter(ShoppingListItem.id == item_id, ShoppingListItem.customer_id == user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if payload.quantity is not None:
        item.quantity = payload.quantity
    if payload.checked is not None:
        item.checked = payload.checked
    db.commit()
    db.refresh(item)
    return item


@router.delete("/shopping-list/{item_id}", status_code=204)
def remove_shopping_list_item(item_id: str, db: Session = Depends(get_db), user: User = Depends(require_customer)):
    item = db.query(ShoppingListItem).filter(ShoppingListItem.id == item_id, ShoppingListItem.customer_id == user.id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()


@router.post("/checkout", response_model=CustomerOrderOut, status_code=201)
def checkout(payload: CheckoutRequest, db: Session = Depends(get_db), user: User = Depends(require_customer)):
    """Turns checked shopping-list items into a real order: computes the
    real total from live product prices, awards 1 loyalty point per AED
    spent (simple and transparent, not a fabricated number), and clears
    those items off the list."""
    items = (
        db.query(ShoppingListItem)
        .filter(ShoppingListItem.customer_id == user.id, ShoppingListItem.checked == True)  # noqa: E712
        .all()
    )
    if not items:
        raise HTTPException(status_code=400, detail="No checked items to check out — check off items on your list first")
    if any(item.quantity <= 0 for item in items):
        raise HTTPException(status_code=422, detail="Item quantity must be at least 1")
    if not db.get(Store, payload.store_id):
        raise HTTPException(status_code=404, detail="Store not found")

    order = CustomerOrder(customer_id=user.id, store_id=payload.store_id, total=0.0, loyalty_points_earned=0, channel="self_checkout")
    db.add(order)
    db.flush()

    total = 0.0
    for item in items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if not product:
            continue
        total += product.price * item.quantity
        db.add(CustomerOrderItem(order_id=order.id, product_id=product.id, quantity=item.quantity, unit_price=product.price))
        taken = consume_stock(db, payload.store_id, product.id, item.quantity)
        if taken < item.quantity:
            record_stock_shortfall(db, payload.store_id, product.name, item.quantity, taken)

    points_earned = int(total)
    order.total = round(total, 2)
    order.loyalty_points_earned = points_earned
    db.refresh(user, with_for_update=True)
    user.loyalty_points = (user.loyalty_points or 0) + points_earned

    for item in items:
        db.delete(item)

    db.commit()
    db.refresh(order)
    return order


@router.get("/receipts", response_model=list[CustomerOrderOut])
def list_receipts(db: Session = Depends(get_db), user: User = Depends(require_customer)):
    return db.query(CustomerOrder).filter(CustomerOrder.customer_id == user.id).order_by(CustomerOrder.created_at.desc()).all()


@router.get("/offers", response_model=list[OfferOut])
def list_offers(db: Session = Depends(get_db), _: User = Depends(require_customer)):
    now = datetime.utcnow()
    return (
        db.query(Offer)
        .filter(Offer.active == True)  # noqa: E712
        .filter((Offer.ends_at.is_(None)) | (Offer.ends_at >= now))
        .all()
    )


@router.get("/recommendations", response_model=list[RecommendationOut])
def recommendations(db: Session = Depends(get_db), user: User = Depends(require_customer)):
    """Real, computed from this customer's own order history when they have
    any — frequently-bought items plus other products in their top
    categories. Falls back to store-wide order popularity, then to a plain
    product sample, for a brand-new account with no history yet — never a
    fixed demo list."""
    frequent = (
        db.query(CustomerOrderItem.product_id, func.sum(CustomerOrderItem.quantity).label("qty"))
        .join(CustomerOrder, CustomerOrder.id == CustomerOrderItem.order_id)
        .filter(CustomerOrder.customer_id == user.id)
        .group_by(CustomerOrderItem.product_id)
        .order_by(func.sum(CustomerOrderItem.quantity).desc())
        .limit(3)
        .all()
    )

    out: list[RecommendationOut] = []
    seen_ids: set[str] = set()
    for product_id, qty in frequent:
        product = db.query(Product).filter(Product.id == product_id).first()
        if product:
            out.append(RecommendationOut(product=product, reason=f"You've bought this {qty} time{'s' if qty != 1 else ''} before"))
            seen_ids.add(product.id)

    if frequent:
        top_categories = [
            c for c, _ in (
                db.query(Product.category, func.sum(CustomerOrderItem.quantity).label("qty"))
                .join(CustomerOrderItem, CustomerOrderItem.product_id == Product.id)
                .join(CustomerOrder, CustomerOrder.id == CustomerOrderItem.order_id)
                .filter(CustomerOrder.customer_id == user.id)
                .group_by(Product.category)
                .order_by(func.sum(CustomerOrderItem.quantity).desc())
                .limit(2)
                .all()
            )
        ]
        for product in db.query(Product).filter(Product.category.in_(top_categories), ~Product.id.in_(seen_ids)).limit(4).all():
            out.append(RecommendationOut(product=product, reason=f"Popular in {product.category}, which you shop often"))
            seen_ids.add(product.id)
    else:
        popular = (
            db.query(CustomerOrderItem.product_id, func.sum(CustomerOrderItem.quantity).label("qty"))
            .group_by(CustomerOrderItem.product_id)
            .order_by(func.sum(CustomerOrderItem.quantity).desc())
            .limit(5)
            .all()
        )
        for product_id, _ in popular:
            product = db.query(Product).filter(Product.id == product_id).first()
            if product:
                out.append(RecommendationOut(product=product, reason="Popular with other customers"))
                seen_ids.add(product.id)
        if not out:
            for product in db.query(Product).limit(5).all():
                out.append(RecommendationOut(product=product, reason="New to the store — worth a try"))

    return out[:6]
