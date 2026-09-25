"""
The bell icon's dropdown — a real feed merged from open alerts, products
that have crossed their reorder threshold, and recent customer orders
("payments"), sorted by recency. Nothing here is a fixed demo list; every
row traces back to a live query.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert, AlertStatus, Batch, BatchStatus, CustomerOrder, Product, User
from app.schemas import NotificationOut
from app.security import require_employee

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationOut])
def list_notifications(store_id: str, db: Session = Depends(get_db), user: User = Depends(require_employee)):
    """Filtered by this user's own Profile → Notification preferences —
    real per-account settings, not just a client-side display toggle."""
    out: list[NotificationOut] = []

    if user.notify_security:
        for a in db.query(Alert).filter(Alert.store_id == store_id, Alert.status != AlertStatus.resolved, Alert.kind == "theft").all():
            out.append(NotificationOut(
                id=f"alert-{a.id}", kind="alert", severity=a.severity.value,
                title=f"Loss prevention alert · {a.location}", detail=a.message, created_at=a.created_at,
            ))

    if user.notify_restock:
        for a in db.query(Alert).filter(Alert.store_id == store_id, Alert.status != AlertStatus.resolved, Alert.kind != "theft").all():
            kind_label = "Quality" if a.kind.value == "quality" else "Stock"
            out.append(NotificationOut(
                id=f"alert-{a.id}", kind="alert", severity=a.severity.value,
                title=f"{kind_label} alert · {a.location}", detail=a.message, created_at=a.created_at,
            ))

        stock_by_product = dict(
            db.query(Batch.product_id, func.coalesce(func.sum(Batch.quantity), 0))
            .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active)
            .group_by(Batch.product_id)
            .all()
        )
        for product in db.query(Product).all():
            current = int(stock_by_product.get(product.id, 0))
            if current < product.reorder_threshold:
                severity = "red" if current == 0 else "amber"
                out.append(NotificationOut(
                    id=f"restock-{product.id}", kind="restock", severity=severity,
                    title=f"{'Out of stock' if current == 0 else 'Low stock'} · {product.name}",
                    detail=f"{current} of {product.reorder_threshold} (reorder point) on hand",
                    created_at=datetime.utcnow(),
                ))

    if user.notify_orders:
        since = datetime.utcnow() - timedelta(hours=48)
        for o in db.query(CustomerOrder).filter(CustomerOrder.store_id == store_id, CustomerOrder.created_at >= since).all():
            out.append(NotificationOut(
                id=f"order-{o.id}", kind="order", severity="green",
                title="Payment received", detail=f"AED {o.total:.2f} · {o.loyalty_points_earned} loyalty points issued",
                created_at=o.created_at,
            ))

    out.sort(key=lambda n: n.created_at, reverse=True)
    return out[:30]
