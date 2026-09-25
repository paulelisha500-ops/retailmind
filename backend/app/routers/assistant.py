"""
AI Business Assistant (Module 9) — multi-agent, but deliberately not an LLM
wrapper: each "agent" below is a plain function that queries live Postgres
data for one business domain and composes an answer from real numbers. No
external model call, no fabricated copy — the honest tradeoff for running
without an LLM API key. The router picks an agent by keyword match on the
question, same as the frontend's old client-side demo did, except now the
answer changes when the underlying data changes.

Swapping this for a real LLM later is a matter of replacing the text
composition in each *_agent function with a prompted call that's still
grounded in the same queries — the retrieval half doesn't change.
"""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Alert, AlertKind, AlertStatus, Batch, BatchStatus, Product, SalesRecord, Supplier, User
from app.security import require_employee

router = APIRouter(prefix="/assistant", tags=["assistant"])

CATEGORY_ALIASES = {
    "dairy": "Dairy & Chilled", "chilled": "Dairy & Chilled",
    "produce": "Produce", "vegetable": "Produce", "fruit": "Produce",
    "frozen": "Frozen",
    "bakery": "Bakery", "bread": "Bakery",
    "meat": "Meat & Seafood", "seafood": "Meat & Seafood",
}


class AskRequest(BaseModel):
    question: str
    store_id: str


class AskResponse(BaseModel):
    agent: str
    tone: str
    text: str


def _quality_agent(db: Session, store_id: str) -> AskResponse:
    cutoff = datetime.utcnow() + timedelta(days=5)
    expiring = (
        db.query(Batch, Product)
        .join(Product, Product.id == Batch.product_id)
        .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active, Batch.expires_at <= cutoff)
        .order_by(Batch.expires_at.asc())
        .limit(3)
        .all()
    )
    open_quality = (
        db.query(Alert)
        .filter(Alert.store_id == store_id, Alert.kind == AlertKind.quality, Alert.status != AlertStatus.resolved)
        .all()
    )
    if not expiring and not open_quality:
        return AskResponse(agent="Quality Agent", tone="green", text="Nothing needs attention right now — no batches expiring in the next 5 days and no open quality flags.")
    parts = []
    if expiring:
        lines = [f"{p.name} ({b.lot_number}) in {b.aisle_location or 'store'} — {(b.expires_at - datetime.utcnow()).days}d left" for b, p in expiring]
        parts.append(f"Expiring soonest: {'; '.join(lines)}.")
    if open_quality:
        parts.append(f"{len(open_quality)} open quality flag(s): {'; '.join(a.message for a in open_quality[:2])}.")
    return AskResponse(agent="Quality Agent", tone="amber", text=" ".join(parts))


def _procurement_agent(db: Session, store_id: str) -> AskResponse:
    suppliers = db.query(Supplier).order_by(Supplier.performance_score.desc()).all()
    if not suppliers:
        return AskResponse(agent="Procurement Agent", tone="neutral", text="No suppliers on file yet.")
    best, worst = suppliers[0], suppliers[-1]
    soon = sorted([s for s in suppliers if s.contract_end], key=lambda s: s.contract_end)
    text = f"{best.name} leads at a {best.performance_score} score with {best.on_time_pct:.0f}% on-time delivery."
    if worst.id != best.id:
        text += f" {worst.name} is the weak link — {worst.performance_score} score, {worst.late_deliveries_30d} late deliveries in the last 30 days."
    if soon:
        nearest = soon[0]
        days = (nearest.contract_end - datetime.utcnow()).days
        if days <= 30:
            text += f" Also worth a look: {nearest.name}'s contract renews in {days} days."
    return AskResponse(agent="Procurement Agent", tone="blue", text=text)


def _forecast_agent(db: Session, store_id: str, question: str) -> AskResponse:
    lower = question.lower()
    category = next((full for alias, full in CATEGORY_ALIASES.items() if alias in lower), None)
    q = db.query(SalesRecord).filter(SalesRecord.store_id == store_id)
    if category:
        q = q.filter(SalesRecord.category == category)
    recent_cutoff = datetime.utcnow() - timedelta(days=7)
    prior_cutoff = datetime.utcnow() - timedelta(days=14)
    recent = [r.units_sold for r in q.filter(SalesRecord.date >= recent_cutoff).all()]
    prior = [r.units_sold for r in q.filter(SalesRecord.date >= prior_cutoff, SalesRecord.date < recent_cutoff).all()]
    label = category or "overall demand"
    if not recent or not prior:
        return AskResponse(agent="Forecast Agent", tone="neutral", text=f"Not enough sales history yet to compare trends for {label}.")
    recent_avg, prior_avg = sum(recent) / len(recent), sum(prior) / len(prior)
    pct = ((recent_avg - prior_avg) / prior_avg * 100) if prior_avg else 0
    direction = "up" if pct >= 0 else "down"
    return AskResponse(
        agent="Forecast Agent", tone="green" if pct >= 0 else "amber",
        text=f"{label} is actually trending {direction} about {abs(pct):.0f}% this week vs last week ({recent_avg:.0f} vs {prior_avg:.0f} units/day avg) — based on live sales_records, not a canned figure.",
    )


def _loss_prevention_agent(db: Session, store_id: str) -> AskResponse:
    open_theft = db.query(Alert).filter(Alert.store_id == store_id, Alert.kind == AlertKind.theft, Alert.status != AlertStatus.resolved).all()
    if not open_theft:
        return AskResponse(agent="Loss Prevention Agent", tone="green", text="No open security flags right now.")
    lines = [f"{a.location}, {a.message.lower()} ({a.confidence:.0f}% confidence)" for a in open_theft]
    return AskResponse(agent="Loss Prevention Agent", tone="red", text=f"{len(open_theft)} open flag(s): {'; '.join(lines)}. Nothing here is auto-actioned — each needs a human review.")


def _inventory_agent(db: Session, store_id: str) -> AskResponse:
    urgent = (
        db.query(Batch, Product)
        .join(Product, Product.id == Batch.product_id)
        .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active)
        .order_by(Batch.expires_at.asc())
        .limit(3)
        .all()
    )
    stock_alerts = db.query(Alert).filter(Alert.store_id == store_id, Alert.kind == AlertKind.stock, Alert.status != AlertStatus.resolved).order_by(Alert.created_at.desc()).all()
    if not urgent and not stock_alerts:
        return AskResponse(agent="Inventory Agent", tone="green", text="No open stock issues right now.")
    parts = []
    if stock_alerts:
        parts.append(f"Priority order by open alerts: {'; '.join(a.location for a in stock_alerts)}.")
    if urgent:
        parts.append(f"Closest to expiry: {', '.join(p.name for _, p in urgent)}.")
    return AskResponse(agent="Inventory Agent", tone="amber", text=" ".join(parts))


AGENT_ROUTES = [
    (["expir", "attention", "freshness", "quality"], lambda db, sid, q: _quality_agent(db, sid)),
    (["supplier", "perform", "best", "worst"], lambda db, sid, q: _procurement_agent(db, sid)),
    (["dairy", "produce", "frozen", "bakery", "meat", "decreas", "declin", "drop", "demand", "sales"], lambda db, sid, q: _forecast_agent(db, sid, q)),
    (["theft", "security", "concern", "safe", "loss"], lambda db, sid, q: _loss_prevention_agent(db, sid)),
    (["restock", "first", "priorit", "stock"], lambda db, sid, q: _inventory_agent(db, sid)),
]


@router.post("/ask", response_model=AskResponse)
def ask(payload: AskRequest, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    lower = payload.question.lower()
    for keywords, handler in AGENT_ROUTES:
        if any(k in lower for k in keywords):
            return handler(db, payload.store_id, payload.question)
    return AskResponse(
        agent="RetailMind Assistant", tone="neutral",
        text="I can help with what's expiring, supplier performance, demand trends, today's security flags, or restock priority — try asking about one of those, or a specific category or supplier by name.",
    )
