"""
Pydantic schemas — the request/response contracts the React/Flutter clients
(and the prototype's screens) are built against. Field names deliberately
mirror the mock data shapes already used in the frontend prototype.
"""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator


class OrmBase(BaseModel):
    model_config = {"from_attributes": True}


# ---------- Auth / IAM ----------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    access_level: Optional[str] = None


class UserMeOut(OrmBase):
    id: str
    name: str
    email: str
    role: str
    department: Optional[str] = None
    title: Optional[str] = None
    access_level: Optional[str] = None
    responsibilities: list[str] = []
    store_id: Optional[str] = None
    loyalty_points: int = 0
    preferred_store_id: Optional[str] = None
    notify_restock: bool = True
    notify_security: bool = True
    notify_orders: bool = True


class UserPreferencesUpdate(BaseModel):
    preferred_store_id: Optional[str] = None
    notify_restock: Optional[bool] = None
    notify_security: Optional[bool] = None
    notify_orders: Optional[bool] = None


class TeamMemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    department: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=120)
    access_level: str = Field(description="staff | manager | admin")
    store_id: str
    responsibilities: list[str] = []

    @field_validator("name", "department", "title")
    @classmethod
    def _strip_required(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, v: str) -> str:
        return v.strip().lower()


class TeamMemberOut(OrmBase):
    id: str
    name: str
    email: str
    department: Optional[str] = None
    title: Optional[str] = None
    access_level: Optional[str] = None
    responsibilities: list[str] = []
    store_id: Optional[str] = None


# ---------- Stores ----------

class StoreOut(OrmBase):
    id: str
    name: str
    code: str
    region: Optional[str] = None
    is_headquarters: bool = False


# ---------- Inventory / batches ----------

class BatchOut(OrmBase):
    id: str
    product_id: str
    store_id: str
    lot_number: str
    quantity: int
    aisle_location: Optional[str] = None
    received_at: datetime
    expires_at: datetime
    status: str


class ShelfFillOut(BaseModel):
    location: str
    category: str
    pct: float


class ProductOut(OrmBase):
    id: str
    sku: str
    barcode: Optional[str] = None
    name: str
    category: str
    unit: str
    price: float
    cost_price: Optional[float] = None
    reorder_threshold: int
    nutrition: dict = {}
    allergens: list[str] = []
    dietary_tags: list[str] = []
    supplier_id: Optional[str] = None


class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=64)
    barcode: Optional[str] = None
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=80)
    unit: str = "each"
    price: float = Field(gt=0, le=1_000_000)
    cost_price: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    reorder_threshold: int = Field(default=10, ge=0, le=1_000_000)
    supplier_id: Optional[str] = None
    nutrition: dict = {}
    allergens: list[str] = []
    dietary_tags: list[str] = []


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=80)
    unit: Optional[str] = None
    price: Optional[float] = Field(default=None, gt=0, le=1_000_000)
    cost_price: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    reorder_threshold: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    supplier_id: Optional[str] = None
    nutrition: Optional[dict] = None
    allergens: Optional[list[str]] = None
    dietary_tags: Optional[list[str]] = None


class ProductImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str] = []


class MoverOut(BaseModel):
    product_id: str
    product_name: str
    category: str
    units_sold_recent: int
    days_of_supply: Optional[float] = None


class NotificationOut(BaseModel):
    id: str
    kind: str  # "alert" | "order" | "restock" | "supplier"
    severity: str  # "red" | "amber" | "green" | "blue"
    title: str
    detail: str
    created_at: datetime


# ---------- Alerts (CCTV / CV pipeline) ----------

class AlertOut(OrmBase):
    id: str
    store_id: str
    kind: str
    severity: str
    model_source: str
    location: str
    message: str
    confidence: float
    status: str
    assigned_to: Optional[str] = None
    created_at: datetime


class AlertResolve(BaseModel):
    resolved_by: str


# ---------- Procurement ----------

class SupplierOut(OrmBase):
    id: str
    name: str
    category: str
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    trade_license_no: Optional[str] = None
    trn: Optional[str] = None
    payment_terms: Optional[str] = None
    cold_chain: Optional[str] = None
    onboarding_status: str = "pending"
    performance_score: int
    on_time_pct: float
    late_deliveries_30d: int
    contract_end: Optional[datetime] = None


OnboardingStatus = Literal["pending", "compliance_review", "approved", "suspended"]


def _blank_to_none_email(v):
    """The supplier form sends "" for an untouched optional email — treat it as unset, but reject anything non-empty that isn't an email."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    return v.strip()


class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=80)
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    trade_license_no: Optional[str] = None
    trn: Optional[str] = None
    payment_terms: Optional[str] = None
    cold_chain: Optional[str] = None
    onboarding_status: OnboardingStatus = "pending"
    performance_score: int = Field(default=80, ge=0, le=100)
    on_time_pct: float = Field(default=90.0, ge=0, le=100)
    late_deliveries_30d: int = Field(default=0, ge=0, le=10_000)
    contract_end: Optional[datetime] = None

    _email_blank = field_validator("contact_email", mode="before")(_blank_to_none_email)


class SupplierUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    category: Optional[str] = Field(default=None, min_length=1, max_length=80)
    contact_email: Optional[EmailStr] = None
    contact_phone: Optional[str] = None
    trade_license_no: Optional[str] = None
    trn: Optional[str] = None
    payment_terms: Optional[str] = None
    cold_chain: Optional[str] = None
    onboarding_status: Optional[OnboardingStatus] = None
    performance_score: Optional[int] = Field(default=None, ge=0, le=100)
    on_time_pct: Optional[float] = Field(default=None, ge=0, le=100)
    late_deliveries_30d: Optional[int] = Field(default=None, ge=0, le=10_000)
    contract_end: Optional[datetime] = None

    _email_blank = field_validator("contact_email", mode="before")(_blank_to_none_email)


class SupplierImportResult(BaseModel):
    created: int
    updated: int
    errors: list[str] = []


class ReorderNeedOut(BaseModel):
    product_id: str
    product_name: str
    category: str
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    current_stock: int
    reorder_threshold: int


class SupplierContactRequest(BaseModel):
    store_id: str
    channel: str = Field(description="email | call")
    product_id: Optional[str] = None
    note: Optional[str] = None


class SupplierContactLogOut(OrmBase):
    id: str
    supplier_id: str
    product_id: Optional[str] = None
    channel: str
    reason: str
    message: str
    status: str
    created_at: datetime


class PurchaseOrderItemOut(OrmBase):
    product_id: str
    quantity: int
    unit_cost: float


class PurchaseOrderOut(OrmBase):
    id: str
    po_number: str
    supplier_id: str
    store_id: str
    status: str
    total_cost: float
    need_by: Optional[datetime] = None
    created_from: str
    forecast_confidence: Optional[float] = None
    items: list[PurchaseOrderItemOut] = []


class PurchaseOrderDecision(BaseModel):
    decided_by: str  # must be an admin/manager — enforced in the router, not just the client


# ---------- Tasks ----------

class TaskOut(OrmBase):
    id: str
    store_id: str
    assigned_to: Optional[str] = None
    title: str
    detail: Optional[str] = None
    source: Optional[str] = None
    done: bool


# ---------- Forecasting ----------

class ForecastPoint(BaseModel):
    label: str
    actual: Optional[float] = None
    predicted: Optional[float] = None
    band_low: Optional[float] = None
    band_high: Optional[float] = None


class ForecastResponse(BaseModel):
    category: str
    model: str
    mape: Optional[float] = None
    points: list[ForecastPoint]
    recommendation: str
    recommended_po_quantity: Optional[int] = None
    confidence: Optional[float] = None


# ---------- Analytics ----------

class KpiOut(BaseModel):
    label: str
    value: str
    delta: str
    good: bool


class AnalyticsSummary(BaseModel):
    kpis: list[KpiOut]
    sales_trend: list[dict]
    category_revenue_mix: list[dict]
    waste_by_category: list[dict]
    store_comparison: list[dict]


# ---------- Warehouse (Module 7) ----------

class WarehouseZoneOut(BaseModel):
    id: str
    name: str
    current_units: int
    capacity_units: int
    pct: float


class PickRouteStep(BaseModel):
    step: int
    location: str
    task: str
    source: str


class CongestionPoint(BaseModel):
    hour: str
    level: float  # 0-100, relative to this store's own busiest hour
    transaction_count: int


class StaffingRecommendation(BaseModel):
    day: str
    recommended_staff: int
    baseline_staff: int
    reason: str


# ---------- Customer app (Modules 10/12) ----------

class ShoppingListItemCreate(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1, le=999)


class ShoppingListItemUpdate(BaseModel):
    quantity: Optional[int] = Field(default=None, ge=1, le=999)
    checked: Optional[bool] = None


class ShoppingListItemOut(OrmBase):
    id: str
    product_id: str
    quantity: int
    checked: bool
    product: ProductOut


class OfferOut(OrmBase):
    id: str
    title: str
    subtitle: Optional[str] = None
    tone: str
    category: Optional[str] = None


class CustomerOrderItemOut(OrmBase):
    product_id: str
    quantity: int
    unit_price: float
    product: ProductOut


class CustomerOrderOut(OrmBase):
    id: str
    store_id: str
    customer_id: Optional[str] = None
    customer_name: str = "Guest"
    total: float
    loyalty_points_earned: int
    points_redeemed: int = 0
    channel: str = "self_checkout"
    cashier_id: Optional[str] = None
    cashier_name: Optional[str] = None
    payment_method: Optional[str] = None
    amount_tendered: Optional[float] = None
    change_due: Optional[float] = None
    created_at: datetime
    items: list[CustomerOrderItemOut] = []


class RecommendationOut(BaseModel):
    product: ProductOut
    reason: str


class CheckoutRequest(BaseModel):
    store_id: str


# ---------- POS / Cashier (Module: register checkout + customer directory) ----------

PAYMENT_METHODS = ("cash", "card", "apple_pay", "google_pay", "samsung_pay", "tabby")


class CustomerDirectoryOut(BaseModel):
    id: str
    name: str
    phone: Optional[str] = None
    email: str
    loyalty_points: int = 0
    member_since: datetime
    total_orders: int = 0
    last_order_at: Optional[datetime] = None


class CustomerDetailOut(CustomerDirectoryOut):
    orders: list[CustomerOrderOut] = []


class QuickCustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=3, max_length=32)
    email: Optional[EmailStr] = None

    @field_validator("email", mode="before")
    @classmethod
    def _blank_email(cls, v):
        return None if v is None or (isinstance(v, str) and not v.strip()) else v.strip().lower()


class CashierLineItem(BaseModel):
    product_id: str
    quantity: int = Field(default=1, ge=1, le=999)


class CashierCheckoutRequest(BaseModel):
    store_id: str
    customer_id: Optional[str] = None
    items: list[CashierLineItem]
    payment_method: str
    amount_tendered: Optional[float] = Field(default=None, ge=0, le=10_000_000)
    points_to_redeem: int = Field(default=0, ge=0)


# ---------- Profit & Loss (admin-only trading P&L, real order/cost data) ----------

class PnlCategoryOut(BaseModel):
    category: str
    revenue: float
    cogs: float
    gross_profit: float
    margin_pct: float


class PnlStoreOut(BaseModel):
    store_id: str
    store_name: str
    store_code: str
    revenue: float
    cogs: float
    gross_profit: float
    margin_pct: float


class PnlTrendPoint(BaseModel):
    label: str
    revenue: float
    cogs: float
    gross_profit: float


class PnlSummary(BaseModel):
    period_days: int
    orders: int
    gross_sales: float
    discounts: float
    net_sales: float
    cogs: float
    gross_profit: float
    margin_pct: float
    avg_order_value: float
    procurement_spend: float
    shrinkage_units: int
    shrinkage_cost: float
    loyalty_liability: float
    products_missing_cost: int
    by_category: list[PnlCategoryOut] = []
    by_store: list[PnlStoreOut] = []
    trend: list[PnlTrendPoint] = []
