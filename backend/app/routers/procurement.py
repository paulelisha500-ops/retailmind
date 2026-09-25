import csv
import io
import math
import re
from datetime import datetime
from typing import get_args

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Batch, BatchStatus, POStatus, Product, PurchaseOrder, Supplier, SupplierContactLog, User
from app.schemas import (
    PurchaseOrderDecision, PurchaseOrderOut, ReorderNeedOut, SupplierContactLogOut,
    OnboardingStatus, SupplierContactRequest, SupplierCreate, SupplierImportResult, SupplierOut, SupplierUpdate,
)
from app.security import require_employee, require_responsibility
from app.services import outreach

SUPPLIER_NULLABLE_FIELDS = {"contact_email", "contact_phone", "trade_license_no", "trn", "payment_terms", "cold_chain", "contract_end"}
ONBOARDING_STATUSES = set(get_args(OnboardingStatus))
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

router = APIRouter(prefix="/procurement", tags=["procurement"])


@router.get("/suppliers", response_model=list[SupplierOut])
def list_suppliers(db: Session = Depends(get_db), _: User = Depends(require_employee)):
    return db.query(Supplier).order_by(Supplier.performance_score.desc()).all()


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
def create_supplier(payload: SupplierCreate, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Supplier Management"))):
    supplier = Supplier(**payload.model_dump())
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.post("/suppliers/import", response_model=SupplierImportResult)
def import_suppliers(file: UploadFile, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Supplier Management"))):
    """CSV import for vendor onboarding, matching an actual UAE hypermarket
    intake sheet: trade license and TRN alongside the usual commercial
    fields — the same data points LuLu's and Majid Al Futtaim/Carrefour's
    supplier registration processes collect before a vendor gets listed.

    Expected header row: name,category (required). Optional: contact_email,
    contact_phone, trade_license_no, trn, payment_terms,
    cold_chain (ambient|chilled|frozen|mixed), onboarding_status
    (pending|compliance_review|approved|suspended), performance_score,
    on_time_pct, late_deliveries_30d. Existing suppliers are matched and
    updated by name (case-insensitive).
    """
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Please upload a .csv file")

    raw = file.file.read().decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None:
        raise HTTPException(status_code=422, detail="Empty file")
    missing = {"name", "category"} - {(f or "").strip().lower() for f in reader.fieldnames}
    if missing:
        raise HTTPException(status_code=422, detail=f"CSV is missing required column(s): {', '.join(sorted(missing))}")

    existing_by_name = {s.name.strip().lower(): s for s in db.query(Supplier).all()}
    created, updated, errors = 0, 0, []

    for i, row in enumerate(reader, start=2):
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        name = row.get("name")
        if not name:
            errors.append(f"Row {i}: missing name, skipped")
            continue

        def _int(key, default):
            return int(row[key]) if row.get(key, "").lstrip("-").isdigit() else default

        def _float(key, default):
            try:
                return float(row[key]) if row.get(key) else default
            except ValueError:
                return default

        fields = dict(
            category=row.get("category") or "Produce",
            contact_email=row.get("contact_email") or None,
            contact_phone=row.get("contact_phone") or None,
            trade_license_no=row.get("trade_license_no") or None,
            trn=row.get("trn") or None,
            payment_terms=row.get("payment_terms") or None,
            cold_chain=row.get("cold_chain") or None,
            onboarding_status=row.get("onboarding_status") or "pending",
            performance_score=_int("performance_score", 80),
            on_time_pct=_float("on_time_pct", 90.0),
            late_deliveries_30d=_int("late_deliveries_30d", 0),
        )

        problem = None
        if fields["contact_email"] and not EMAIL_RE.match(fields["contact_email"]):
            problem = "contact_email is not a valid email"
        elif fields["onboarding_status"] not in ONBOARDING_STATUSES:
            problem = "onboarding_status must be pending, compliance_review, approved or suspended"
        elif not 0 <= fields["performance_score"] <= 100:
            problem = "performance_score must be 0-100"
        elif not (math.isfinite(fields["on_time_pct"]) and 0 <= fields["on_time_pct"] <= 100):
            problem = "on_time_pct must be 0-100"
        elif fields["late_deliveries_30d"] < 0:
            problem = "late_deliveries_30d can't be negative"
        if problem:
            errors.append(f"Row {i}: {problem}, skipped")
            continue

        existing = existing_by_name.get(name.lower())
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(Supplier(name=name, **fields))
            created += 1

    db.commit()
    return SupplierImportResult(created=created, updated=updated, errors=errors)


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut)
def update_supplier(supplier_id: str, payload: SupplierUpdate, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Supplier Management"))):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None and field not in SUPPLIER_NULLABLE_FIELDS:
            continue
        setattr(supplier, field, value)
    db.commit()
    db.refresh(supplier)
    return supplier


@router.delete("/suppliers/{supplier_id}", status_code=204)
def delete_supplier(supplier_id: str, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Supplier Management"))):
    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    try:
        db.delete(supplier)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Can't delete — this supplier has products or purchase orders referencing it. Reassign or remove those first.")


@router.get("/reorder-needed", response_model=list[ReorderNeedOut])
def reorder_needed(store_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """Real detection: every product whose total active stock at this store
    has fallen below its own reorder_threshold (0 if it has no batches at
    all — a stockout). This is what drives the 'needs supplier contact'
    flags — not a fixed list."""
    stock_by_product = dict(
        db.query(Batch.product_id, func.coalesce(func.sum(Batch.quantity), 0))
        .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active)
        .group_by(Batch.product_id)
        .all()
    )
    out = []
    for product in db.query(Product).all():
        current = int(stock_by_product.get(product.id, 0))
        if current < product.reorder_threshold:
            supplier = db.query(Supplier).filter(Supplier.id == product.supplier_id).first() if product.supplier_id else None
            out.append(ReorderNeedOut(
                product_id=product.id, product_name=product.name, category=product.category,
                supplier_id=supplier.id if supplier else None, supplier_name=supplier.name if supplier else None,
                current_stock=current, reorder_threshold=product.reorder_threshold,
            ))
    return out


@router.post("/suppliers/{supplier_id}/notify", response_model=SupplierContactLogOut, status_code=201)
def notify_supplier(
    supplier_id: str,
    payload: SupplierContactRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_responsibility("Supplier Management")),
):
    """Manager-triggered, every time — per-click, not a silent background
    job, matching the standing rule that sending a real message on someone's
    behalf needs a deliberate action. Actually dispatches only if a
    provider is configured (see app/services/outreach.py); otherwise logs
    exactly what would have been sent."""
    if payload.channel not in ("email", "call"):
        raise HTTPException(status_code=422, detail="channel must be 'email' or 'call'")

    supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    product = db.query(Product).filter(Product.id == payload.product_id).first() if payload.product_id else None
    if product:
        reason = f"{product.name} is low on stock (below its reorder threshold of {product.reorder_threshold})."
    else:
        reason = payload.note or "Manual outreach requested."
    message = (
        f"Hi {supplier.name}, this is {user.name} from RetailMind. {reason} "
        f"Could you confirm availability and lead time for a reorder?"
        + (f" Note: {payload.note}" if payload.note and product else "")
    )

    if payload.channel == "email":
        status, detail = outreach.send_email(supplier.contact_email, f"Reorder needed — {product.name if product else supplier.name}", message)
    else:
        status, detail = outreach.place_call(supplier.contact_phone, message)

    log = SupplierContactLog(
        supplier_id=supplier.id, store_id=payload.store_id,
        product_id=product.id if product else None, triggered_by=user.id,
        channel=payload.channel, reason=f"{reason} [{detail}]", message=message, status=status,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/contact-log", response_model=list[SupplierContactLogOut])
def contact_log(store_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    return (
        db.query(SupplierContactLog)
        .filter(SupplierContactLog.store_id == store_id)
        .order_by(SupplierContactLog.created_at.desc())
        .limit(50)
        .all()
    )


@router.get("/orders", response_model=list[PurchaseOrderOut])
def list_orders(
    store_id: str,
    status: str | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_employee),
):
    q = db.query(PurchaseOrder).filter(PurchaseOrder.store_id == store_id)
    if status:
        q = q.filter(PurchaseOrder.status == status)
    return q.order_by(PurchaseOrder.created_at.desc()).all()


@router.patch("/orders/{order_id}/approve", response_model=PurchaseOrderOut)
def approve_order(
    order_id: str,
    payload: PurchaseOrderDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_responsibility("Purchase Approvals")),
):
    """Gated the same way the frontend gates it: Admin always passes,
    anyone else needs 'Purchase Approvals' explicitly assigned in Team &
    Access. Associates calling this without that responsibility get a 403,
    matching the 'pending admin approval' read-only state in the UI."""
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.status != POStatus.draft:
        raise HTTPException(status_code=409, detail=f"Order is already {order.status.value}")

    order.status = POStatus.approved
    order.approved_by = user.id
    order.approved_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order


@router.patch("/orders/{order_id}/reject", response_model=PurchaseOrderOut)
def reject_order(
    order_id: str,
    payload: PurchaseOrderDecision,
    db: Session = Depends(get_db),
    user: User = Depends(require_responsibility("Purchase Approvals")),
):
    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    if order.status != POStatus.draft:
        raise HTTPException(status_code=409, detail=f"Order is already {order.status.value}")

    order.status = POStatus.rejected
    order.approved_by = user.id
    order.approved_at = datetime.utcnow()
    db.commit()
    db.refresh(order)
    return order
