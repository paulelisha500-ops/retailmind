"""
ORM models — the PostgreSQL half of the recommended stack.

Design notes (matching the architecture discussed with the client):
  - Perishables are tracked at the BATCH/LOT level, not just product level,
    so FEFO (first-expired-first-out) picking and expiry alerts are possible.
  - Every alert (stock/quality/theft) records which CV model produced it and
    a confidence score, and is routed to a specific employee — nothing here
    represents an auto-actioned decision, only a flagged-for-review one.
  - `responsibilities` on User is the IAM permission set an admin assigns in
    Team & Access (mirrors RESPONSIBILITIES in the frontend prototype).
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer,
    JSON, String, Text,
)
from sqlalchemy.orm import relationship

from app.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class AccessLevel(str, enum.Enum):
    staff = "staff"
    manager = "manager"
    admin = "admin"


class UserRole(str, enum.Enum):
    customer = "customer"
    employee = "employee"


class AlertKind(str, enum.Enum):
    stock = "stock"
    quality = "quality"
    theft = "theft"


class AlertSeverity(str, enum.Enum):
    green = "green"
    amber = "amber"
    red = "red"


class AlertStatus(str, enum.Enum):
    open = "open"
    reviewing = "reviewing"
    resolved = "resolved"


class POStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    rejected = "rejected"
    delivered = "delivered"


class BatchStatus(str, enum.Enum):
    active = "active"
    markdown = "markdown"
    removed = "removed"


class Store(Base):
    __tablename__ = "stores"
    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    code = Column(String, unique=True, nullable=False)
    region = Column(String, nullable=True)
    is_headquarters = Column(Boolean, default=False)  # used for enterprise rollups
    created_at = Column(DateTime, default=datetime.utcnow)

    users = relationship("User", back_populates="store", foreign_keys="User.store_id")
    batches = relationship("Batch", back_populates="store")
    alerts = relationship("Alert", back_populates="store")


class User(Base):
    """Covers both customers and staff. Staff carry IAM fields; customers don't."""
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False, index=True)
    phone = Column(String, unique=True, nullable=True, index=True)  # the field UAE loyalty lookups (LuLu/Carrefour) key off at the register
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False, default=UserRole.customer)

    # --- IAM fields (role == employee only) ---
    department = Column(String, nullable=True)
    title = Column(String, nullable=True)
    access_level = Column(Enum(AccessLevel), nullable=True)
    responsibilities = Column(JSON, default=list)  # e.g. ["Inventory Monitoring", "Purchase Approvals"]
    store_id = Column(String, ForeignKey("stores.id"), nullable=True)

    # --- Customer fields ---
    loyalty_points = Column(Integer, default=0)
    preferred_store_id = Column(String, ForeignKey("stores.id"), nullable=True)  # customers: checkout defaults here

    # --- Notification preferences (Profile screen) — real per-user settings
    # that actually filter what /notifications returns, not just UI toggles. ---
    notify_restock = Column(Boolean, default=True)
    notify_security = Column(Boolean, default=True)
    notify_orders = Column(Boolean, default=True)

    created_at = Column(DateTime, default=datetime.utcnow)

    store = relationship("Store", back_populates="users", foreign_keys=[store_id])

    def has_responsibility(self, name: str) -> bool:
        return self.access_level == AccessLevel.admin or name in (self.responsibilities or [])


class Supplier(Base):
    """Field set modeled on how UAE hypermarket chains actually onboard
    vendors — LuLu's supplier portal requires compliance-form completion
    and cold-chain capability disclosure before listing; Majid Al
    Futtaim/Carrefour centralizes vendor registration through SAP Ariba
    gated by Code-of-Conduct sign-off. trade_license_no/trn are the real
    UAE business-registration fields those onboarding forms collect."""
    __tablename__ = "suppliers"
    id = Column(String, primary_key=True, default=_uuid)
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)
    contact_email = Column(String, nullable=True)
    contact_phone = Column(String, nullable=True)
    trade_license_no = Column(String, nullable=True)  # UAE Trade License number
    trn = Column(String, nullable=True)  # UAE Tax Registration Number (VAT)
    payment_terms = Column(String, nullable=True)  # e.g. "Net 30", "Net 60"
    cold_chain = Column(String, nullable=True)  # "ambient" | "chilled" | "frozen" | "mixed"
    onboarding_status = Column(String, default="pending")  # "pending" | "compliance_review" | "approved" | "suspended"
    contract_start = Column(DateTime, nullable=True)
    contract_end = Column(DateTime, nullable=True)
    performance_score = Column(Integer, default=0)   # 0-100, recomputed nightly from delivery history
    on_time_pct = Column(Float, default=0.0)
    late_deliveries_30d = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)

    products = relationship("Product", back_populates="supplier")
    purchase_orders = relationship("PurchaseOrder", back_populates="supplier")


class Product(Base):
    """Centralized SKU record — one source of truth per product."""
    __tablename__ = "products"
    id = Column(String, primary_key=True, default=_uuid)
    sku = Column(String, unique=True, nullable=False, index=True)
    barcode = Column(String, unique=True, nullable=True, index=True)  # powers the customer app's product scanner
    name = Column(String, nullable=False)
    category = Column(String, nullable=False)  # Produce / Dairy & Chilled / Frozen / Bakery / Meat & Seafood
    unit = Column(String, default="each")
    price = Column(Float, nullable=False)
    cost_price = Column(Float, nullable=True)  # landed unit cost — real COGS/margin math in the P&L needs this, not just retail price
    supplier_id = Column(String, ForeignKey("suppliers.id"), nullable=True)
    reorder_threshold = Column(Integer, default=10)
    # Nutrition/allergen data would live in MongoDB in the target
    # architecture (see backend/README.md), joined in at read time — this
    # scaffold doesn't run Mongo, so it's modeled here as JSON columns
    # instead of faked with hardcoded response data.
    nutrition = Column(JSON, default=dict)          # e.g. {"kcal": 52, "carbs_g": 14, "fiber_g": 2.4}
    allergens = Column(JSON, default=list)           # e.g. ["milk", "gluten"]
    dietary_tags = Column(JSON, default=list)         # e.g. ["Gluten-free", "No added sugar"]
    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier", back_populates="products")
    batches = relationship("Batch", back_populates="product")


class Batch(Base):
    """A single received lot of a product at a store — the FEFO unit."""
    __tablename__ = "batches"
    id = Column(String, primary_key=True, default=_uuid)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    lot_number = Column(String, nullable=False)
    quantity = Column(Integer, nullable=False)
    aisle_location = Column(String, nullable=True)  # e.g. "Aisle 05 · Row B"
    received_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False, index=True)  # indexed: expiry queries run constantly
    status = Column(Enum(BatchStatus), default=BatchStatus.active)

    product = relationship("Product", back_populates="batches")
    store = relationship("Store", back_populates="batches")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    id = Column(String, primary_key=True, default=_uuid)
    po_number = Column(String, unique=True, nullable=False)
    supplier_id = Column(String, ForeignKey("suppliers.id"), nullable=False)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    status = Column(Enum(POStatus), default=POStatus.draft)
    total_cost = Column(Float, default=0.0)
    need_by = Column(DateTime, nullable=True)
    created_from = Column(String, default="manual")  # "forecast" | "manual" | "reorder_threshold"
    forecast_confidence = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_by = Column(String, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)

    supplier = relationship("Supplier", back_populates="purchase_orders")
    items = relationship("PurchaseOrderItem", back_populates="purchase_order", cascade="all, delete-orphan")


class PurchaseOrderItem(Base):
    __tablename__ = "purchase_order_items"
    id = Column(String, primary_key=True, default=_uuid)
    purchase_order_id = Column(String, ForeignKey("purchase_orders.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_cost = Column(Float, nullable=False)

    purchase_order = relationship("PurchaseOrder", back_populates="items")


class Alert(Base):
    """Output of the CV pipeline (YOLO/SAM/ViT) or manual flag — always human-reviewed."""
    __tablename__ = "alerts"
    id = Column(String, primary_key=True, default=_uuid)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    kind = Column(Enum(AlertKind), nullable=False)
    severity = Column(Enum(AlertSeverity), nullable=False)
    model_source = Column(String, nullable=False)  # e.g. "YOLO + SAM", "ViT"
    location = Column(String, nullable=False)       # e.g. "Aisle 05 · Dairy, Row B"
    message = Column(Text, nullable=False)
    confidence = Column(Float, nullable=False)
    status = Column(Enum(AlertStatus), default=AlertStatus.open)
    assigned_to = Column(String, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved_at = Column(DateTime, nullable=True)

    store = relationship("Store", back_populates="alerts")


class Task(Base):
    __tablename__ = "tasks"
    id = Column(String, primary_key=True, default=_uuid)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    assigned_to = Column(String, ForeignKey("users.id"), nullable=True)
    title = Column(String, nullable=False)
    detail = Column(String, nullable=True)
    source = Column(String, nullable=True)  # "Shelf monitoring" | "Procurement" | ...
    done = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SalesRecord(Base):
    """Daily per-category sales — the training table behind Forecast Studio."""
    __tablename__ = "sales_records"
    id = Column(String, primary_key=True, default=_uuid)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    category = Column(String, nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)
    units_sold = Column(Integer, nullable=False)
    revenue = Column(Float, nullable=False)
    promo_flag = Column(Boolean, default=False)
    temperature_c = Column(Float, nullable=True)
    is_holiday = Column(Boolean, default=False)
    local_event_flag = Column(Boolean, default=False)


class WarehouseZone(Base):
    """A storage zone within a store's warehouse/backroom. Utilization is
    computed live from real Batch quantities (see routers/warehouse.py) —
    this table only holds the zone's identity and capacity, not a fill %."""
    __tablename__ = "warehouse_zones"
    id = Column(String, primary_key=True, default=_uuid)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    name = Column(String, nullable=False)
    categories = Column(JSON, default=list)  # product categories this zone stores; [] = receiving/staging (no category)
    capacity_units = Column(Integer, nullable=False)
    sort_order = Column(Integer, default=0)


class Transaction(Base):
    """One checkout event — real timestamp granularity (unlike the daily
    SalesRecord rollup) so floor-traffic/congestion can be computed by hour
    instead of faked. A production system would get these from POS, not a
    seed script, but the computation over them is real either way."""
    __tablename__ = "transactions"
    id = Column(String, primary_key=True, default=_uuid)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    timestamp = Column(DateTime, nullable=False, index=True)
    category = Column(String, nullable=True)
    amount = Column(Float, default=0.0)


class ShoppingListItem(Base):
    """A customer's in-progress shopping list — Module 12."""
    __tablename__ = "shopping_list_items"
    id = Column(String, primary_key=True, default=_uuid)
    customer_id = Column(String, ForeignKey("users.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, default=1)
    checked = Column(Boolean, default=False)
    added_at = Column(DateTime, default=datetime.utcnow)

    product = relationship("Product")


class Offer(Base):
    """Store-wide or category-scoped promotion shown on the customer app's
    Offers screen and Home 'for you today' row."""
    __tablename__ = "offers"
    id = Column(String, primary_key=True, default=_uuid)
    title = Column(String, nullable=False)
    subtitle = Column(String, nullable=True)
    tone = Column(String, default="green")  # drives the UI accent color: green | blue | amber
    category = Column(String, nullable=True)  # null = store-wide
    active = Column(Boolean, default=True)
    starts_at = Column(DateTime, default=datetime.utcnow)
    ends_at = Column(DateTime, nullable=True)


class CustomerOrder(Base):
    """A completed purchase — powers digital receipts and loyalty points, and
    is the real data source recommendations are computed from. Covers both
    checkout paths: the customer app's self-checkout (channel=self_checkout,
    cashier_id null) and a staff-operated register sale (channel=cashier,
    payment_method/amount_tendered/change_due filled in like a real POS
    till). customer_id is nullable because a real till constantly rings up
    guest/walk-in sales with no loyalty account attached — see LuLu/
    Carrefour register flow, where scanning a loyalty card is optional."""
    __tablename__ = "customer_orders"
    id = Column(String, primary_key=True, default=_uuid)
    customer_id = Column(String, ForeignKey("users.id"), nullable=True)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    total = Column(Float, nullable=False)
    loyalty_points_earned = Column(Integer, default=0)
    points_redeemed = Column(Integer, default=0)  # loyalty points applied as a discount on this sale
    channel = Column(String, default="self_checkout")  # "self_checkout" | "cashier"
    cashier_id = Column(String, ForeignKey("users.id"), nullable=True)  # staff member who rang this up, if channel=cashier
    payment_method = Column(String, nullable=True)  # "cash" | "card" | "apple_pay" | "google_pay" | "samsung_pay" | "tabby"
    amount_tendered = Column(Float, nullable=True)  # cash only
    change_due = Column(Float, nullable=True)       # cash only
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("CustomerOrderItem", back_populates="order", cascade="all, delete-orphan")
    customer = relationship("User", foreign_keys=[customer_id])
    cashier = relationship("User", foreign_keys=[cashier_id])

    @property
    def customer_name(self) -> str:
        return self.customer.name if self.customer else "Guest"

    @property
    def cashier_name(self):
        return self.cashier.name if self.cashier else None


class CustomerOrderItem(Base):
    __tablename__ = "customer_order_items"
    id = Column(String, primary_key=True, default=_uuid)
    order_id = Column(String, ForeignKey("customer_orders.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_price = Column(Float, nullable=False)

    order = relationship("CustomerOrder", back_populates="items")
    product = relationship("Product")


class SupplierContactLog(Base):
    """A record of supplier outreach — real detection (why contact was
    needed) and a real log entry every time, whether or not a message
    provider is actually configured. Without one, status stays 'simulated'
    (nothing dispatched) instead of silently pretending to have called or
    emailed anyone; see app/services/outreach.py."""
    __tablename__ = "supplier_contact_log"
    id = Column(String, primary_key=True, default=_uuid)
    supplier_id = Column(String, ForeignKey("suppliers.id"), nullable=False)
    store_id = Column(String, ForeignKey("stores.id"), nullable=False)
    product_id = Column(String, ForeignKey("products.id"), nullable=True)
    triggered_by = Column(String, ForeignKey("users.id"), nullable=True)
    channel = Column(String, nullable=False)  # "email" | "call"
    reason = Column(Text, nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String, default="simulated")  # "simulated" | "sent" | "failed"
    created_at = Column(DateTime, default=datetime.utcnow)

    supplier = relationship("Supplier")
    product = relationship("Product")
