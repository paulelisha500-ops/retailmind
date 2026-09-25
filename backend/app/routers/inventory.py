import csv
import math
import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Batch, BatchStatus, Product, Supplier, User
from app.schemas import BatchOut, ProductCreate, ProductImportResult, ProductOut, ProductUpdate, ShelfFillOut
from app.security import require_employee, require_responsibility

router = APIRouter(prefix="/inventory", tags=["inventory"])

NUTRITION_COLUMNS = ["kcal", "carbs_g", "fiber_g", "protein_g", "fat_g"]


@router.get("/products", response_model=list[ProductOut])
def list_products(category: str | None = None, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    q = db.query(Product)
    if category:
        q = q.filter(Product.category == category)
    return q.order_by(Product.name).all()


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(payload: ProductCreate, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Inventory Monitoring"))):
    if db.query(Product).filter(Product.sku == payload.sku).first():
        raise HTTPException(status_code=409, detail=f"SKU {payload.sku} already exists")
    product = Product(**payload.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    return product


@router.patch("/products/{product_id}", response_model=ProductOut)
def update_product(product_id: str, payload: ProductUpdate, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Inventory Monitoring"))):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is None and field not in ("cost_price", "supplier_id"):
            continue
        setattr(product, field, value)
    db.commit()
    db.refresh(product)
    return product


@router.delete("/products/{product_id}", status_code=204)
def delete_product(product_id: str, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Inventory Monitoring"))):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    try:
        db.delete(product)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Can't delete — this product has batches, orders, or purchase history referencing it")


@router.post("/products/import", response_model=ProductImportResult)
def import_products(file: UploadFile, db: Session = Depends(get_db), _: User = Depends(require_responsibility("Inventory Monitoring"))):
    """CSV import — the practical equivalent of a Google Sheets upload (File
    > Download > Comma-separated values (.csv) in Sheets produces exactly
    this format). Live Google Sheets API sync would need an OAuth app
    registered under your Google account, which isn't something to set up
    silently; CSV covers the same real workflow without that dependency.

    Expected header row: sku,name,category,price (required) plus any of
    barcode,unit,cost_price,reorder_threshold,supplier_name,allergens,
    dietary_tags,kcal,carbs_g,fiber_g,protein_g,fat_g (optional). allergens/
    dietary_tags are semicolon-separated within their cell. cost_price (the
    landed unit cost, not the shelf price) drives real margin numbers in
    Analytics → Profit & Loss — worth filling in even though it's optional.
    """
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Please upload a .csv file (export a Google Sheet as CSV, or any spreadsheet as CSV)")

    raw = file.file.read().decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    if reader.fieldnames is None:
        raise HTTPException(status_code=422, detail="Empty file")
    missing = {"sku", "name", "category", "price"} - {(f or "").strip().lower() for f in reader.fieldnames}
    if missing:
        raise HTTPException(status_code=422, detail=f"CSV is missing required column(s): {', '.join(sorted(missing))}")

    suppliers_by_name = {s.name.strip().lower(): s for s in db.query(Supplier).all()}
    created, updated, errors = 0, 0, []

    for i, row in enumerate(reader, start=2):  # row 1 is the header
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        try:
            sku = row["sku"]
            if not sku:
                errors.append(f"Row {i}: missing sku, skipped")
                continue
            price = float(row["price"])
        except (KeyError, ValueError):
            errors.append(f"Row {i}: invalid or missing price, skipped")
            continue
        if not (math.isfinite(price) and 0 < price <= 1_000_000):
            errors.append(f"Row {i}: price must be between 0 and 1,000,000, skipped")
            continue
        if not row.get("name") or not row.get("category"):
            errors.append(f"Row {i}: name and category are required, skipped")
            continue

        nutrition = {}
        for col in NUTRITION_COLUMNS:
            if row.get(col):
                try:
                    nutrition[col] = float(row[col])
                except ValueError:
                    pass

        cost_price = None
        if row.get("cost_price"):
            try:
                cost_price = float(row["cost_price"])
            except ValueError:
                pass
            if cost_price is not None and not (math.isfinite(cost_price) and 0 <= cost_price <= 1_000_000):
                errors.append(f"Row {i}: cost_price must be between 0 and 1,000,000, skipped")
                continue

        supplier = suppliers_by_name.get(row.get("supplier_name", "").lower()) if row.get("supplier_name") else None
        fields = dict(
            name=row["name"], category=row["category"], price=price, cost_price=cost_price,
            barcode=row.get("barcode") or None,
            unit=row.get("unit") or "each",
            reorder_threshold=int(row["reorder_threshold"]) if row.get("reorder_threshold", "").isdigit() else 10,
            supplier_id=supplier.id if supplier else None,
            allergens=[a.strip() for a in row.get("allergens", "").split(";") if a.strip()],
            dietary_tags=[t.strip() for t in row.get("dietary_tags", "").split(";") if t.strip()],
            nutrition=nutrition,
        )

        existing = db.query(Product).filter(Product.sku == sku).first()
        if existing:
            for k, v in fields.items():
                setattr(existing, k, v)
            updated += 1
        else:
            db.add(Product(sku=sku, **fields))
            created += 1

    db.commit()
    return ProductImportResult(created=created, updated=updated, errors=errors)


@router.get("/expiring-soon", response_model=list[BatchOut])
def expiring_soon(
    store_id: str,
    within_days: int = 7,
    db: Session = Depends(get_db),
    _: User = Depends(require_employee),
):
    """FEFO in practice: batches closest to their expiry date first, so
    picking/markdown decisions always work the oldest-expiring stock first
    regardless of which delivery it arrived in."""
    cutoff = datetime.utcnow() + timedelta(days=within_days)
    return (
        db.query(Batch)
        .filter(
            Batch.store_id == store_id,
            Batch.status == BatchStatus.active,
            Batch.expires_at <= cutoff,
        )
        .order_by(Batch.expires_at.asc())
        .all()
    )


@router.get("/shelf-fill", response_model=list[ShelfFillOut])
def shelf_fill(store_id: str, db: Session = Depends(get_db), _: User = Depends(require_employee)):
    """Real per-aisle shelf-fill %, computed from live batch quantities
    against each product's reorder threshold — replaces what a shelf-facing
    camera tile would show, without pretending there's a live video feed."""
    rows = (
        db.query(Batch, Product)
        .join(Product, Product.id == Batch.product_id)
        .filter(Batch.store_id == store_id, Batch.status == BatchStatus.active)
        .all()
    )
    by_aisle: dict[str, dict] = {}
    for batch, product in rows:
        aisle = (batch.aisle_location or "Unassigned").split("·")[0].strip()
        entry = by_aisle.setdefault(aisle, {"current": 0, "capacity": 0, "category": product.category})
        entry["current"] += batch.quantity
        entry["capacity"] += product.reorder_threshold * 15  # "full shelf" reference: 15x the reorder point

    out = []
    for aisle, v in sorted(by_aisle.items()):
        pct = round(min(100.0, v["current"] / v["capacity"] * 100), 0) if v["capacity"] else 0.0
        out.append(ShelfFillOut(location=aisle, category=v["category"], pct=pct))
    return out
