"""
Stock fulfillment — decrements real Batch quantities when a sale completes,
shared by both checkout paths (customer self-checkout and the cashier
register) so a sale always leaves the same trail behind it: shelf-fill,
reorder-needed and warehouse zone utilization all read Batch rows directly,
so a sale that didn't touch them would make those screens quietly drift from
reality.

Consumption is FEFO (first-expired-first-out), matching the batch/lot model
described in app/models.py — the same order a real perishables floor would
pull stock in. If recorded stock runs short of what's being sold (a real,
common till-vs-shelf mismatch in any store), we deduct what's there and stop
rather than blocking the sale or going negative: the customer is already
holding the item, so the software's job is to record the discrepancy for the
next stock count, not to pretend the sale didn't happen.
"""
from sqlalchemy.orm import Session

from app.models import Batch, BatchStatus, Task


def consume_stock(db: Session, store_id: str, product_id: str, quantity: int) -> int:
    """Decrements active batches of `product_id` at `store_id`, oldest-expiry
    first, by up to `quantity` units. Returns the amount actually consumed
    (may be less than requested if recorded stock is insufficient)."""
    if quantity <= 0:
        return 0
    remaining = quantity
    batches = (
        db.query(Batch)
        .filter(Batch.product_id == product_id, Batch.store_id == store_id, Batch.status == BatchStatus.active)
        .order_by(Batch.expires_at.asc())
        .with_for_update()
        .all()
    )
    for batch in batches:
        if remaining <= 0:
            break
        take = min(batch.quantity, remaining)
        batch.quantity -= take
        remaining -= take
        if batch.quantity <= 0:
            batch.status = BatchStatus.removed
    return quantity - remaining


def record_stock_shortfall(db: Session, store_id: str, product_name: str, requested: int, consumed: int) -> None:
    """The sale still completes (see the module docstring), but the mismatch
    lands on the store's task list so the next stock count corrects it."""
    title = f"Stock count: {product_name}"
    detail = f"Sold {requested} but only {consumed} on record — check the shelf and correct inventory"
    existing = db.query(Task).filter(Task.store_id == store_id, Task.title == title, Task.done == False).first()  # noqa: E712
    if existing:
        existing.detail = detail
    else:
        db.add(Task(store_id=store_id, title=title, detail=detail, source="Stock count", done=False))
        db.flush()  # the session doesn't autoflush; without this a second line for the same product would add a duplicate task
