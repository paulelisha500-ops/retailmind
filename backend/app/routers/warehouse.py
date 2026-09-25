"""
Warehouse optimization (Module 7) — storage utilization, pick routes, and
floor-traffic congestion, all computed live from real rows rather than a
fixed demo array. Congestion needs point-of-sale timestamp granularity
SalesRecord doesn't have, so it reads from `transactions` instead — seeded
with a synthetic-but-realistic hourly pattern (same honesty tradeoff as
every other seeded table in this app: the base data is a demo seed, the
numbers shown are always a real aggregation over it, never hardcoded).
"""
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import extract, func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert, AlertKind, AlertStatus, Batch, BatchStatus, Product, PurchaseOrder, PurchaseOrderItem, POStatus, Transaction, User, WarehouseZone
from app.schemas import CongestionPoint, PickRouteStep, StaffingRecommendation, WarehouseZoneOut
from app.security import require_employee

router = APIRouter(prefix="/warehouse", tags=["warehouse"])


@router.get("/zones", response_model=list[WarehouseZoneOut])
def zones(store_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    out = []
    for zone in db.query(WarehouseZone).filter(WarehouseZone.store_id == store_id).order_by(WarehouseZone.sort_order).all():
        if zone.categories:
            current = (
                db.query(func.coalesce(func.sum(Batch.quantity), 0))
                .join(Product, Product.id == Batch.product_id)
                .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active, Product.category.in_(zone.categories))
                .scalar()
            )
        else:
            # Receiving/staging has no product category of its own — use
            # expected inbound units (draft + approved POs) as the real proxy.
            current = (
                db.query(func.coalesce(func.sum(PurchaseOrderItem.quantity), 0))
                .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
                .filter(PurchaseOrder.store_id == store_id, PurchaseOrder.status.in_([POStatus.draft, POStatus.approved]))
                .scalar()
            )
        current = int(current or 0)
        out.append(WarehouseZoneOut(
            id=zone.id, name=zone.name, current_units=current, capacity_units=zone.capacity_units,
            pct=round(min(100.0, current / zone.capacity_units * 100), 1) if zone.capacity_units else 0.0,
        ))
    return out


def _aisle_sort_key(location: str | None) -> tuple:
    if not location:
        return (999, "")
    match = re.search(r"\d+", location)
    return (int(match.group()) if match else 999, location)


@router.get("/pick-route", response_model=list[PickRouteStep])
def pick_route(store_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """A real replenishment route: every open stock/quality alert plus every
    batch expiring within 3 days, ordered by aisle number — the same
    physical-proximity heuristic a real picking-route optimizer uses,
    just without a warehouse map to route-plan against."""
    steps = []

    open_alerts = (
        db.query(Alert)
        .filter(Alert.store_id == store_id, Alert.status != AlertStatus.resolved, Alert.kind != AlertKind.theft)
        .all()
    )
    for a in open_alerts:
        steps.append({"location": a.location, "task": a.message, "source": "Shelf/quality alert"})

    cutoff = datetime.utcnow() + timedelta(days=3)
    alert_locations = {a.location for a in open_alerts}
    expiring = (
        db.query(Batch, Product)
        .join(Product, Product.id == Batch.product_id)
        .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active, Batch.expires_at <= cutoff)
        .all()
    )
    for batch, product in expiring:
        loc = batch.aisle_location or "Unassigned"
        if loc in alert_locations:
            continue  # already covered by an alert at the same spot
        days_left = max(0, (batch.expires_at - datetime.utcnow()).days)
        steps.append({"location": loc, "task": f"Rotate/markdown {product.name} — {days_left}d left ({batch.lot_number})", "source": "FEFO expiry"})

    steps.sort(key=lambda s: _aisle_sort_key(s["location"]))
    return [PickRouteStep(step=i + 1, location=s["location"], task=s["task"], source=s["source"]) for i, s in enumerate(steps)]


@router.get("/congestion", response_model=list[CongestionPoint])
def congestion(store_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """Average transaction count per hour-of-day, from real (seeded)
    checkout timestamps — normalized 0-100 against this store's own busiest
    hour, not a fixed curve."""
    rows = (
        db.query(
            extract("hour", Transaction.timestamp).label("hour"),
            func.count(Transaction.id).label("cnt"),
            func.count(func.distinct(func.date(Transaction.timestamp))).label("days"),
        )
        .filter(Transaction.store_id == store_id)
        .group_by("hour")
        .all()
    )
    if not rows:
        return []
    avgs = {int(r.hour): (r.cnt / r.days if r.days else 0) for r in rows}
    peak = max(avgs.values()) or 1
    out = []
    for hour in sorted(avgs):
        avg = avgs[hour]
        label = f"{hour % 12 or 12}{'a' if hour < 12 else 'p'}"
        out.append(CongestionPoint(hour=label, level=round(avg / peak * 100, 1), transaction_count=round(avg)))
    return out


@router.get("/staffing", response_model=StaffingRecommendation)
def staffing(store_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """Compares average Saturday transaction volume to the weekday average
    over the same window and scales a baseline staff count by that real
    ratio — a transparent formula, not a fixed 'staff up' claim."""
    baseline_staff = 4
    rows = db.query(Transaction.timestamp).filter(Transaction.store_id == store_id).all()
    if not rows:
        return StaffingRecommendation(day="Saturday", recommended_staff=baseline_staff, baseline_staff=baseline_staff, reason="No transaction history yet — showing the baseline crew size.")

    by_day: dict[str, int] = {}
    for (ts,) in rows:
        key = ts.strftime("%Y-%m-%d")
        by_day[key] = by_day.get(key, 0) + 1

    sat_counts, weekday_counts = [], []
    for key, count in by_day.items():
        dow = datetime.strptime(key, "%Y-%m-%d").weekday()
        (sat_counts if dow == 5 else weekday_counts).append(count)

    if not sat_counts or not weekday_counts:
        return StaffingRecommendation(day="Saturday", recommended_staff=baseline_staff, baseline_staff=baseline_staff, reason="Not enough same-week history yet to compare Saturday to weekdays.")

    sat_avg = sum(sat_counts) / len(sat_counts)
    weekday_avg = sum(weekday_counts) / len(weekday_counts)
    ratio = sat_avg / weekday_avg if weekday_avg else 1.0
    recommended = max(baseline_staff, round(baseline_staff * ratio))
    pct = round((ratio - 1) * 100)
    return StaffingRecommendation(
        day="Saturday", recommended_staff=recommended, baseline_staff=baseline_staff,
        reason=f"Saturday averages {sat_avg:.0f} transactions/day vs {weekday_avg:.0f} on weekdays ({'+' if pct >= 0 else ''}{pct}%) over the recorded history — scaled from a baseline crew of {baseline_staff}.",
    )
