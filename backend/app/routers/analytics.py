from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.constants import POINTS_TO_AED
from app.database import get_db
from app.models import (
    Batch, BatchStatus, CustomerOrder, CustomerOrderItem, POStatus, Product,
    PurchaseOrder, SalesRecord, Store, User, UserRole,
)
from app.schemas import AnalyticsSummary, KpiOut, MoverOut, PnlCategoryOut, PnlStoreOut, PnlSummary, PnlTrendPoint
from app.security import require_admin, require_employee

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/summary", response_model=AnalyticsSummary)
def analytics_summary(
    store_id: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
):
    """Admin-only, matching the frontend: revenue and margin data isn't
    shown to Associates there, and isn't exposed here either. Pass no
    store_id for the Enterprise 'all stores' rollup, or a specific
    store_id for the Single Store / drill-down view."""
    since = datetime.utcnow() - timedelta(days=7)
    q = db.query(SalesRecord).filter(SalesRecord.date >= since)
    if store_id:
        q = q.filter(SalesRecord.store_id == store_id)
    records = q.all()

    total_revenue = sum(r.revenue for r in records)
    total_units = sum(r.units_sold for r in records)
    promo_units = sum(r.units_sold for r in records if r.promo_flag)

    # --- sales trend: revenue grouped by day ---
    by_day: dict[str, float] = {}
    for r in records:
        key = r.date.strftime("%a")
        by_day[key] = by_day.get(key, 0.0) + r.revenue
    sales_trend = [{"day": d, "revenue": round(v, 2)} for d, v in by_day.items()]

    # --- category revenue mix ---
    by_cat: dict[str, float] = {}
    for r in records:
        by_cat[r.category] = by_cat.get(r.category, 0.0) + r.revenue
    category_revenue_mix = [
        {"name": c, "value": round((v / total_revenue) * 100, 1) if total_revenue else 0}
        for c, v in by_cat.items()
    ]

    # --- waste by category: real % of received units marked removed
    # (spoiled/expired/damaged), per category. None (not 0) when a category
    # has no batches at all yet — "no data" is never shown as "no waste". ---
    waste_by_category = []
    for cat in by_cat.keys():
        batch_q = db.query(Batch).join(Product, Product.id == Batch.product_id).filter(Product.category == cat)
        if store_id:
            batch_q = batch_q.filter(Batch.store_id == store_id)
        batches = batch_q.all()
        total_qty = sum(b.quantity for b in batches)
        removed_qty = sum(b.quantity for b in batches if b.status == BatchStatus.removed)
        pct = round(removed_qty / total_qty * 100, 1) if total_qty else None
        waste_by_category.append({"name": cat, "pct": pct})

    # --- store comparison: only meaningful cross-store, i.e. no store_id filter ---
    store_comparison = []
    if store_id is None:
        stores = db.query(Store).all()
        for s in stores:
            store_revenue = (
                db.query(func.sum(SalesRecord.revenue))
                .filter(SalesRecord.store_id == s.id, SalesRecord.date >= since)
                .scalar()
                or 0
            )
            store_comparison.append({"name": s.name, "code": s.code, "revenue": round(store_revenue, 2)})

    kpis = [
        KpiOut(label="Revenue (7d)", value=f"AED {total_revenue:,.0f}", delta="see trend below", good=True),
        KpiOut(label="Units sold (7d)", value=f"{total_units:,}", delta=f"{len(by_cat)} categories", good=True),
        KpiOut(label="Avg daily revenue", value=f"AED {total_revenue/7:,.0f}", delta="7-day window", good=True),
        KpiOut(label="Promo-driven units", value=f"{promo_units:,}", delta=f"{(promo_units/total_units*100) if total_units else 0:.0f}% of units" , good=True),
    ]

    return AnalyticsSummary(
        kpis=kpis,
        sales_trend=sales_trend,
        category_revenue_mix=category_revenue_mix,
        waste_by_category=waste_by_category,
        store_comparison=store_comparison,
    )


@router.get("/movers", response_model=list[MoverOut])
def movers(store_id: str, days: int = 14, limit: int = 10, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """What's selling out fast: real per-product velocity from actual
    checkout line items (CustomerOrderItem) over the trailing window,
    ranked descending, with real days-of-supply against current stock.
    Sparse until more real orders exist — that's honest, not a bug."""
    since = datetime.utcnow() - timedelta(days=days)
    sold = (
        db.query(CustomerOrderItem.product_id, func.coalesce(func.sum(CustomerOrderItem.quantity), 0).label("qty"))
        .join(CustomerOrder, CustomerOrder.id == CustomerOrderItem.order_id)
        .filter(CustomerOrder.store_id == store_id, CustomerOrder.created_at >= since)
        .group_by(CustomerOrderItem.product_id)
        .order_by(func.sum(CustomerOrderItem.quantity).desc())
        .limit(limit)
        .all()
    )
    stock_by_product = dict(
        db.query(Batch.product_id, func.coalesce(func.sum(Batch.quantity), 0))
        .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active)
        .group_by(Batch.product_id)
        .all()
    )

    out = []
    for product_id, qty in sold:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product:
            continue
        current_stock = int(stock_by_product.get(product_id, 0))
        daily_rate = qty / days
        days_of_supply = round(current_stock / daily_rate, 1) if daily_rate > 0 else None
        out.append(MoverOut(
            product_id=product.id, product_name=product.name, category=product.category,
            units_sold_recent=int(qty), days_of_supply=days_of_supply,
        ))
    return out


@router.get("/pnl", response_model=PnlSummary)
def profit_and_loss(store_id: str | None = None, days: int = 30, db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Real trading P&L, at the level a UAE hypermarket store manager
    actually reviews (LuLu, Carrefour/Majid Al Futtaim): Gross Sales, less
    loyalty-point discounts, is Net Sales; less Cost of Goods Sold (COGS, at
    each product's landed unit cost) is Gross Profit. Every figure comes
    from real CustomerOrder/CustomerOrderItem rows placed through checkout
    or the register — nothing here is simulated. Rent and payroll aren't
    modeled in this system, so this stops at gross margin rather than a
    full net-income statement — the honest boundary of what this data can
    actually support.
    """
    since = datetime.utcnow() - timedelta(days=days)

    order_q = db.query(CustomerOrder).filter(CustomerOrder.created_at >= since)
    if store_id:
        order_q = order_q.filter(CustomerOrder.store_id == store_id)
    orders = order_q.all()
    order_ids = [o.id for o in orders]

    items = db.query(CustomerOrderItem).filter(CustomerOrderItem.order_id.in_(order_ids)).all() if order_ids else []
    product_ids = {it.product_id for it in items}
    products_by_id = {p.id: p for p in db.query(Product).filter(Product.id.in_(product_ids)).all()} if product_ids else {}
    items_by_order: dict[str, list] = {}
    for it in items:
        items_by_order.setdefault(it.order_id, []).append(it)

    def item_cost(it) -> float:
        product = products_by_id.get(it.product_id)
        return it.quantity * (product.cost_price if product and product.cost_price is not None else 0.0)

    gross_sales = sum(it.unit_price * it.quantity for it in items)
    discounts = sum((o.points_redeemed or 0) * POINTS_TO_AED for o in orders)
    net_sales = round(gross_sales - discounts, 2)

    missing_cost_products = {it.product_id for it in items if not products_by_id.get(it.product_id) or products_by_id[it.product_id].cost_price is None}
    cogs = round(sum(item_cost(it) for it in items), 2)
    gross_profit = round(net_sales - cogs, 2)
    margin_pct = round(gross_profit / net_sales * 100, 1) if net_sales else 0.0
    avg_order_value = round(net_sales / len(orders), 2) if orders else 0.0

    # --- procurement spend: real cash committed to suppliers this window ---
    po_q = db.query(PurchaseOrder).filter(
        PurchaseOrder.created_at >= since, PurchaseOrder.status.in_([POStatus.approved, POStatus.delivered]),
    )
    if store_id:
        po_q = po_q.filter(PurchaseOrder.store_id == store_id)
    procurement_spend = round(sum(po.total_cost for po in po_q.all()), 2)

    # --- shrinkage: batches written off (spoiled/expired/damaged), not sold
    # through. A batch fully sold via checkout also ends up status=removed,
    # but fulfillment.py drains its quantity to 0 first — only a removed
    # batch that STILL has quantity on it represents real waste. ---
    shrink_q = db.query(Batch).filter(Batch.status == BatchStatus.removed, Batch.quantity > 0)
    if store_id:
        shrink_q = shrink_q.filter(Batch.store_id == store_id)
    shrink_batches = shrink_q.all()
    shrinkage_units = sum(b.quantity for b in shrink_batches)
    shrink_products = {p.id: p for p in db.query(Product).filter(Product.id.in_({b.product_id for b in shrink_batches})).all()} if shrink_batches else {}
    shrinkage_cost = round(sum(b.quantity * (shrink_products[b.product_id].cost_price or 0.0) for b in shrink_batches if b.product_id in shrink_products), 2)

    # --- loyalty liability: points on customer accounts are a real
    # redeemable-for-AED balance — carried as a liability the same way
    # LuLu/Carrefour loyalty points sit on the books. Not store-scoped: a
    # customer's balance isn't tied to any one store. ---
    total_points = db.query(func.coalesce(func.sum(User.loyalty_points), 0)).filter(User.role == UserRole.customer).scalar() or 0
    loyalty_liability = round(total_points * POINTS_TO_AED, 2)

    # --- by category (gross, pre-discount — discounts aren't category-specific) ---
    cat_totals: dict[str, dict] = {}
    for it in items:
        product = products_by_id.get(it.product_id)
        cat = product.category if product else "Uncategorized"
        entry = cat_totals.setdefault(cat, {"revenue": 0.0, "cogs": 0.0})
        entry["revenue"] += it.unit_price * it.quantity
        entry["cogs"] += item_cost(it)
    by_category = []
    for cat, v in sorted(cat_totals.items(), key=lambda kv: kv[1]["revenue"], reverse=True):
        gp = v["revenue"] - v["cogs"]
        by_category.append(PnlCategoryOut(
            category=cat, revenue=round(v["revenue"], 2), cogs=round(v["cogs"], 2),
            gross_profit=round(gp, 2), margin_pct=round(gp / v["revenue"] * 100, 1) if v["revenue"] else 0.0,
        ))

    # --- by store: only meaningful for the enterprise ("all stores") view.
    # Every store appears, including ones with no sales this window — a
    # silent 0 is a real, useful answer here ("nothing sold"), not one to hide. ---
    by_store = []
    if store_id is None:
        all_stores = db.query(Store).all()
        store_totals: dict[str, dict] = {s.id: {"revenue": 0.0, "cogs": 0.0} for s in all_stores}
        for o in orders:
            entry = store_totals.setdefault(o.store_id, {"revenue": 0.0, "cogs": 0.0})
            for it in items_by_order.get(o.id, []):
                entry["revenue"] += it.unit_price * it.quantity
                entry["cogs"] += item_cost(it)
        stores_by_id = {s.id: s for s in all_stores}
        for sid, v in sorted(store_totals.items(), key=lambda kv: kv[1]["revenue"], reverse=True):
            s = stores_by_id.get(sid)
            if not s:
                continue
            gp = v["revenue"] - v["cogs"]
            by_store.append(PnlStoreOut(
                store_id=sid, store_name=s.name, store_code=s.code,
                revenue=round(v["revenue"], 2), cogs=round(v["cogs"], 2),
                gross_profit=round(gp, 2), margin_pct=round(gp / v["revenue"] * 100, 1) if v["revenue"] else 0.0,
            ))

    # --- daily trend: net sales per day against that day's COGS ---
    trend_totals: dict[str, dict] = {}
    for o in orders:
        key = o.created_at.strftime("%b %d")
        entry = trend_totals.setdefault(key, {"revenue": 0.0, "cogs": 0.0, "date": o.created_at.date()})
        entry["revenue"] += o.total
        for it in items_by_order.get(o.id, []):
            entry["cogs"] += item_cost(it)
    trend = [
        PnlTrendPoint(label=k, revenue=round(v["revenue"], 2), cogs=round(v["cogs"], 2), gross_profit=round(v["revenue"] - v["cogs"], 2))
        for k, v in sorted(trend_totals.items(), key=lambda kv: kv[1]["date"])
    ]

    return PnlSummary(
        period_days=days, orders=len(orders), gross_sales=round(gross_sales, 2), discounts=round(discounts, 2),
        net_sales=net_sales, cogs=cogs, gross_profit=gross_profit, margin_pct=margin_pct, avg_order_value=avg_order_value,
        procurement_spend=procurement_spend, shrinkage_units=shrinkage_units, shrinkage_cost=shrinkage_cost,
        loyalty_liability=loyalty_liability, products_missing_cost=len(missing_cost_products),
        by_category=by_category, by_store=by_store, trend=trend,
    )
