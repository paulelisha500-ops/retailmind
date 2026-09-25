"""
Seeds the database with the same demo entities the React prototype uses
(same store names, same team members, same suppliers) so a demo of the
frontend and a demo of this API tell the same story.

Run with:  python -m app.seed
"""
import random
import secrets
from datetime import datetime, timedelta

from app.database import Base, SessionLocal, engine
from app.models import (
    AccessLevel, Alert, AlertKind, AlertSeverity, Batch, BatchStatus,
    CustomerOrder, CustomerOrderItem, Offer, POStatus, Product, PurchaseOrder,
    PurchaseOrderItem, SalesRecord, ShoppingListItem, Store, Supplier, Task,
    Transaction, User, UserRole, WarehouseZone,
)
from app.security import hash_password

CATEGORIES = ["Produce", "Dairy & Chilled", "Frozen", "Bakery", "Meat & Seafood"]

# Rough grocery-store hourly traffic shape (weights, not counts) — used only
# to seed plausible transaction timestamps; congestion/staffing endpoints
# compute real numbers from these rows, they never see this array directly.
HOURLY_WEIGHTS = [0, 0, 0, 0, 0, 0, 1, 3, 5, 6, 7, 8, 10, 9, 6, 5, 6, 8, 10, 9, 6, 3, 1, 0]


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if db.query(Store).first():
        print("Database already seeded — skipping. Drop tables first to reseed.")
        return

    # --- Stores ---
    stores = [
        Store(name="Downtown Central", code="#104", region="Central", is_headquarters=True),
        Store(name="Riverside Mall", code="#212", region="East"),
        Store(name="North Hills", code="#319", region="North"),
        Store(name="Airport Plaza", code="#087", region="West"),
    ]
    db.add_all(stores)
    db.commit()
    hq = stores[0]

    # --- Suppliers ---
    # contact_email/phone use the .example / 555-01xx ranges reserved for
    # fiction — safe placeholders real mail/dialing will never reach, even if
    # a real provider is later configured (see app/services/outreach.py).
    # trade_license_no/trn/payment_terms/cold_chain/onboarding_status mirror
    # the real vendor-onboarding fields UAE hypermarket chains collect
    # (LuLu's supplier compliance forms + cold-chain disclosure; Majid Al
    # Futtaim/Carrefour's SAP Ariba registration gated by Code-of-Conduct
    # sign-off) — trade license and TRN numbers below are fictional formats.
    suppliers = [
        Supplier(name="Fresh Farms Co.", category="Produce", performance_score=94, on_time_pct=97, late_deliveries_30d=0,
                  contact_email="orders@freshfarms.example.com", contact_phone="+1-555-0101",
                  trade_license_no="DED-771234", trn="100123456700003", payment_terms="Net 30",
                  cold_chain="chilled", onboarding_status="approved",
                  contract_end=datetime.utcnow() + timedelta(days=45)),
        Supplier(name="Nordic Dairy Direct", category="Dairy & Chilled", performance_score=88, on_time_pct=91, late_deliveries_30d=1,
                  contact_email="orders@nordicdairy.example.com", contact_phone="+1-555-0102",
                  trade_license_no="DED-771235", trn="100123456700010", payment_terms="Net 30",
                  cold_chain="chilled", onboarding_status="approved",
                  contract_end=datetime.utcnow() + timedelta(days=12)),
        Supplier(name="Polar Cold Logistics", category="Frozen", performance_score=96, on_time_pct=99, late_deliveries_30d=0,
                  contact_email="orders@polarcold.example.com", contact_phone="+1-555-0103",
                  trade_license_no="DED-771236", trn="100123456700027", payment_terms="Net 45",
                  cold_chain="frozen", onboarding_status="approved",
                  contract_end=datetime.utcnow() + timedelta(days=210)),
        Supplier(name="Golden Wheat Bakers", category="Bakery", performance_score=79, on_time_pct=82, late_deliveries_30d=2,
                  contact_email="orders@goldenwheat.example.com", contact_phone="+1-555-0104",
                  trade_license_no="DED-771237", trn="100123456700034", payment_terms="Net 30",
                  cold_chain="ambient", onboarding_status="compliance_review",
                  contract_end=datetime.utcnow() + timedelta(days=90)),
        Supplier(name="Prime Cut Meats", category="Meat & Seafood", performance_score=91, on_time_pct=95, late_deliveries_30d=0,
                  contact_email="orders@primecut.example.com", contact_phone="+1-555-0105",
                  trade_license_no="DED-771238", trn="100123456700041", payment_terms="Net 30",
                  cold_chain="chilled", onboarding_status="approved",
                  contract_end=datetime.utcnow() + timedelta(days=150)),
    ]
    db.add_all(suppliers)
    db.commit()

    # --- Team (same names/roles as the frontend prototype) ---
    team = [
        User(name="Marcus Tan", email="marcus@retailmind.demo", phone="+971-50-100-1001", hashed_password=hash_password("demo1234"),
             role=UserRole.employee, department="Store Management", title="Store Incharge",
             access_level=AccessLevel.admin, store_id=hq.id,
             responsibilities=["Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals", "Team & Access"]),
        User(name="Priya Sharma", email="priya@retailmind.demo", phone="+971-50-100-1002", hashed_password=hash_password("demo1234"),
             role=UserRole.employee, department="Inventory & Shelf Ops", title="Inventory & Shelf Lead",
             access_level=AccessLevel.manager, store_id=hq.id,
             responsibilities=["Inventory Monitoring", "Shelf & CCTV Alerts"]),
        User(name="Diego Ramirez", email="diego@retailmind.demo", phone="+971-50-100-1003", hashed_password=hash_password("demo1234"),
             role=UserRole.employee, department="Procurement & Suppliers", title="Procurement Associate",
             access_level=AccessLevel.staff, store_id=hq.id,
             responsibilities=["Supplier Management"]),
        User(name="Aisha Khan", email="aisha@retailmind.demo", phone="+971-50-100-1004", hashed_password=hash_password("demo1234"),
             role=UserRole.employee, department="Food Safety & Quality", title="Food Safety Inspector",
             access_level=AccessLevel.staff, store_id=hq.id,
             responsibilities=["Shelf & CCTV Alerts"]),
        User(name="Layla Hassan", email="layla@example.com", phone="+971-55-200-2001", hashed_password=hash_password("demo1234"),
             role=UserRole.customer, loyalty_points=1240),
    ]
    db.add_all(team)
    db.commit()
    marcus, priya, diego, aisha, layla = team

    # --- Extra loyalty customers (no login demoed for these — same "enrolled
    # in-store, real record, no app session" state a register quick-enroll
    # produces) so the Cashier/Customers directory reflects a real roster
    # rather than a single account. ---
    # unusable random password: these accounts exist as real loyalty/CRM
    # records but were never given app login credentials, same as a real
    # in-store quick-enrollment (see POST /pos/customers).
    extra_customers = [
        User(name="Omar Al Suwaidi", email="omar.alsuwaidi@example.com", phone="+971-55-200-2002",
             hashed_password=hash_password(secrets.token_urlsafe(24)), role=UserRole.customer, loyalty_points=860),
        User(name="Fatima Al Zaabi", email="fatima.alzaabi@example.com", phone="+971-55-200-2003",
             hashed_password=hash_password(secrets.token_urlsafe(24)), role=UserRole.customer, loyalty_points=2130),
        User(name="Rahul Menon", email="rahul.menon@example.com", phone="+971-55-200-2004",
             hashed_password=hash_password(secrets.token_urlsafe(24)), role=UserRole.customer, loyalty_points=310),
        User(name="Noora Hassan", email="noora.hassan@example.com", phone="+971-55-200-2005",
             hashed_password=hash_password(secrets.token_urlsafe(24)), role=UserRole.customer, loyalty_points=45),
    ]
    db.add_all(extra_customers)
    db.commit()

    # --- Products (3 per category, with real nutrition/allergen data since
    # there's no MongoDB running here to source it from — see models.py) ---
    product_seed = [
        # sku, barcode, name, category, unit, price, supplier, aisle, nutrition, allergens, tags
        ("SKU-1001", "8901000000011", "Gala Apples (kg)", "Produce", "kg", 8.90, 0, "Aisle 02 · Row A",
         {"kcal": 52, "carbs_g": 14, "fiber_g": 2.4, "protein_g": 0.3}, [], ["Gluten-free", "Vegan"]),
        ("SKU-1002", "8901000000028", "Baby Spinach (200g)", "Produce", "each", 6.50, 0, "Aisle 02 · Row B",
         {"kcal": 23, "carbs_g": 3.6, "fiber_g": 2.2, "protein_g": 2.9}, [], ["Gluten-free", "Vegan", "Keto-friendly"]),
        ("SKU-1003", "8901000000035", "Ripe Bananas (kg)", "Produce", "kg", 4.20, 0, "Aisle 02 · Row C",
         {"kcal": 89, "carbs_g": 23, "fiber_g": 2.6, "protein_g": 1.1}, [], ["Gluten-free", "Vegan"]),

        ("SKU-1101", "8901000001018", "Whole Milk (2L)", "Dairy & Chilled", "each", 12.50, 1, "Aisle 05 · Row B",
         {"kcal": 61, "carbs_g": 4.8, "fat_g": 3.3, "protein_g": 3.2}, ["milk"], []),
        ("SKU-1102", "8901000001025", "Greek Yogurt (500g)", "Dairy & Chilled", "each", 11.90, 1, "Aisle 05 · Row A",
         {"kcal": 97, "carbs_g": 3.9, "fat_g": 5, "protein_g": 9}, ["milk"], ["High-protein"]),
        ("SKU-1103", "8901000001032", "Free-range Eggs (12)", "Dairy & Chilled", "each", 14.50, 1, "Aisle 05 · Row C",
         {"kcal": 155, "carbs_g": 1.1, "fat_g": 11, "protein_g": 13}, ["egg"], ["Free-range"]),

        ("SKU-1201", "8901000002015", "Frozen Peas (1kg)", "Frozen", "each", 6.20, 2, "Aisle 08 · Row A",
         {"kcal": 81, "carbs_g": 14, "fiber_g": 5, "protein_g": 5}, [], ["Vegan", "Gluten-free"]),
        ("SKU-1202", "8901000002022", "Frozen Mixed Berries (500g)", "Frozen", "each", 9.80, 2, "Aisle 08 · Row B",
         {"kcal": 57, "carbs_g": 14, "fiber_g": 3, "protein_g": 0.7}, [], ["Vegan", "Gluten-free", "No added sugar"]),
        ("SKU-1203", "8901000002039", "Frozen Margherita Pizza", "Frozen", "each", 8.50, 2, "Aisle 08 · Row C",
         {"kcal": 249, "carbs_g": 33, "fat_g": 9, "protein_g": 11}, ["milk", "gluten"], []),

        ("SKU-1301", "8901000003012", "Sourdough Loaf", "Bakery", "each", 9.90, 3, "Aisle 11 · Tray 4",
         {"kcal": 289, "carbs_g": 57, "fiber_g": 2.9, "protein_g": 10}, ["gluten"], []),
        ("SKU-1302", "8901000003029", "Croissants (4-pack)", "Bakery", "each", 10.50, 3, "Aisle 11 · Tray 2",
         {"kcal": 406, "carbs_g": 45, "fat_g": 21, "protein_g": 8}, ["gluten", "milk", "egg"], []),
        ("SKU-1303", "8901000003036", "Multigrain Bread", "Bakery", "each", 8.90, 3, "Aisle 11 · Tray 1",
         {"kcal": 265, "carbs_g": 43, "fiber_g": 6, "protein_g": 11}, ["gluten"], ["High-fiber"]),

        ("SKU-1401", "8901000004019", "Ground Beef (kg)", "Meat & Seafood", "kg", 34.00, 4, "Aisle 14 · Row A",
         {"kcal": 250, "carbs_g": 0, "fat_g": 17, "protein_g": 26}, [], ["High-protein"]),
        ("SKU-1402", "8901000004026", "Atlantic Salmon Fillet (kg)", "Meat & Seafood", "kg", 48.00, 4, "Aisle 14 · Row B",
         {"kcal": 208, "carbs_g": 0, "fat_g": 13, "protein_g": 20}, ["fish"], ["High-protein", "Omega-3"]),
        ("SKU-1403", "8901000004033", "Chicken Breast (kg)", "Meat & Seafood", "kg", 28.50, 4, "Aisle 14 · Row C",
         {"kcal": 165, "carbs_g": 0, "fat_g": 3.6, "protein_g": 31}, [], ["High-protein", "Low-fat"]),
    ]
    # Realistic per-category reorder points (default of 10 can never trigger
    # against a 10-300 random batch quantity — these can, honestly, ~15-30%
    # of the time depending on category, same as a real store).
    reorder_threshold_by_category = {"Produce": 60, "Dairy & Chilled": 70, "Frozen": 25, "Bakery": 55, "Meat & Seafood": 40}

    # Real UAE hypermarket category gross-margin benchmarks (LuLu/Carrefour-
    # style grocery retail): produce and frozen run ~28-32%, dairy is
    # tighter (~22-26%) from heavy price competition on staples like milk,
    # in-house bakery is the highest-margin department (~48-52%, low
    # ingredient cost relative to shelf price), and meat/seafood is the
    # thinnest (~18-22%, perishable and often used as a footfall driver).
    # cost_price = price × (1 − margin) — this is what makes the P&L
    # (Analytics → Profit & Loss) a real gross-margin computation instead of
    # a revenue-only number.
    margin_by_category = {"Produce": 0.30, "Dairy & Chilled": 0.24, "Frozen": 0.30, "Bakery": 0.50, "Meat & Seafood": 0.20}

    products = []
    aisles = {}
    for sku, barcode, name, cat, unit, price, sup_idx, aisle, nutrition, allergens, tags in product_seed:
        p = Product(sku=sku, barcode=barcode, name=name, category=cat, unit=unit, price=price,
                    cost_price=round(price * (1 - margin_by_category.get(cat, 0.25)), 2),
                    supplier_id=suppliers[sup_idx].id, nutrition=nutrition, allergens=allergens, dietary_tags=tags,
                    reorder_threshold=reorder_threshold_by_category.get(cat, 10))
        products.append(p)
        aisles[sku] = aisle
    db.add_all(products)
    db.commit()
    by_sku = {p.sku: p for p in products}

    batches = []
    for p in products:
        batches.append(Batch(
            product_id=p.id, store_id=hq.id, lot_number=f"LOT-{1000 + products.index(p)}",
            quantity=random.randint(10, 300), aisle_location=aisles[p.sku],
            expires_at=datetime.utcnow() + timedelta(days=random.randint(1, 20)),
            status=BatchStatus.active,
        ))
    # One real removed/wasted batch (matches the "Bakery batch #2291" quality
    # flag already seeded below) so waste_by_category has a real % to show
    # instead of permanently null.
    batches.append(Batch(
        product_id=by_sku["SKU-1302"].id, store_id=hq.id, lot_number="LOT-2291", quantity=18,
        aisle_location="Aisle 11 · Tray 2", expires_at=datetime.utcnow() - timedelta(days=1),
        status=BatchStatus.removed,
    ))
    db.add_all(batches)
    db.commit()

    # --- Alerts (matching the CCTV screen's seed data) ---
    alerts = [
        Alert(store_id=hq.id, kind=AlertKind.stock, severity=AlertSeverity.amber, model_source="YOLO + SAM",
              location="Aisle 05 · Dairy, Row B", message="Shelf space 88% empty — Whole Milk running under par",
              confidence=96, assigned_to=priya.id),
        Alert(store_id=hq.id, kind=AlertKind.theft, severity=AlertSeverity.red, model_source="YOLO + ViT",
              location="Checkout Zone · Lane 3", message="Concealment gesture pattern flagged — item moved to bag without scan",
              confidence=84, assigned_to=marcus.id),
    ]
    db.add_all(alerts)
    db.commit()

    # --- Purchase orders (matching Procurement screen's seed data) ---
    po = PurchaseOrder(
        po_number="PO-1042", supplier_id=suppliers[1].id, store_id=hq.id, status=POStatus.draft,
        total_cost=3180, need_by=datetime.utcnow() + timedelta(days=2),
        created_from="forecast", forecast_confidence=0.94,
    )
    db.add(po)
    db.commit()
    db.add(PurchaseOrderItem(purchase_order_id=po.id, product_id=by_sku["SKU-1101"].id, quantity=340, unit_cost=9.35))
    db.commit()

    # --- Tasks (matching the Home/Tasks screens' seed data) ---
    tasks = [
        Task(store_id=hq.id, assigned_to=priya.id, title="Restock Aisle 05 · Dairy Row B",
             detail="Whole Milk — shelf 88% empty", source="Shelf monitoring", done=False),
        Task(store_id=hq.id, assigned_to=diego.id, title="Approve delivery — Fresh Farms Co.",
             detail="Produce · ETA 2:30 PM · 340kg", source="Supplier schedule", done=False),
        Task(store_id=hq.id, assigned_to=aisha.id, title="Quality check — Bakery batch #2291",
             detail="Freshness score flagged for review", source="Quality inspection", done=False),
        Task(store_id=hq.id, assigned_to=marcus.id, title="Review CCTV flag — Checkout Lane 3",
             detail="Concealment pattern, 84% confidence", source="Loss prevention", done=False),
        Task(store_id=hq.id, assigned_to=priya.id, title="Restock Aisle 02 · Produce Bin 3",
             detail="Crate count below par", source="Shelf monitoring", done=True),
        Task(store_id=hq.id, assigned_to=marcus.id, title="Review purchase order PO-1042",
             detail="AED 3,180 · AI-drafted from Forecast Studio", source="Procurement", done=False),
    ]
    db.add_all(tasks)
    db.commit()

    # --- Sales history (90 days × every store, so forecast_prophet/xgboost/
    # lstm/tft have something to train on for any store an admin selects,
    # not just headquarters — and so Analytics/Forecast Studio aren't blank
    # the moment a non-HQ store is picked. HQ is modeled as the larger
    # flagship location; the others run realistic size multipliers of it,
    # the way a chain's smaller-format stores actually undersell its
    # flagship rather than all reporting identical volume. ---
    store_size_mult = {stores[0].id: 1.0, stores[1].id: 0.55, stores[2].id: 0.4, stores[3].id: 0.7}
    sales = []
    for store in stores:
        mult = store_size_mult.get(store.id, 0.5)
        for cat in CATEGORIES:
            base = {"Produce": 420, "Dairy & Chilled": 260, "Frozen": 180, "Bakery": 150, "Meat & Seafood": 210}[cat] * mult
            for d in range(90, 0, -1):
                date = datetime.utcnow() - timedelta(days=d)
                units = max(0, int(base + random.gauss(0, base * 0.12) + (40 * mult if date.weekday() >= 5 else 0)))
                sales.append(SalesRecord(
                    store_id=store.id, category=cat, date=date, units_sold=units,
                    revenue=round(units * random.uniform(3.5, 6.5), 2),
                    promo_flag=random.random() < 0.1,
                    temperature_c=round(random.uniform(18, 38), 1),
                    is_holiday=False,
                    local_event_flag=random.random() < 0.05,
                ))
    db.add_all(sales)
    db.commit()

    # --- Warehouse zones (Module 7) — utilization is computed live from
    # Batch/PO rows at request time; this just defines the zones themselves ---
    zones = [
        WarehouseZone(store_id=hq.id, name="Zone A · Dry Goods & Produce", categories=["Bakery", "Produce"], capacity_units=1100, sort_order=1),
        WarehouseZone(store_id=hq.id, name="Zone B · Cold Storage", categories=["Dairy & Chilled", "Meat & Seafood"], capacity_units=1100, sort_order=2),
        WarehouseZone(store_id=hq.id, name="Zone C · Frozen", categories=["Frozen"], capacity_units=550, sort_order=3),
        WarehouseZone(store_id=hq.id, name="Zone D · Receiving & Staging", categories=[], capacity_units=500, sort_order=4),
    ]
    db.add_all(zones)
    db.commit()

    # --- Transactions (21 days of hourly-weighted checkout events, so
    # Warehouse congestion/staffing can compute real numbers from real
    # timestamps instead of a hardcoded curve) ---
    transactions = []
    for d in range(21, 0, -1):
        day = datetime.utcnow() - timedelta(days=d)
        day_start = day.replace(hour=0, minute=0, second=0, microsecond=0)
        weekend_mult = 1.5 if day_start.weekday() == 5 else (1.2 if day_start.weekday() == 6 else 1.0)
        for hour, weight in enumerate(HOURLY_WEIGHTS):
            count = int(round(weight * weekend_mult * random.uniform(0.7, 1.3)))
            for _ in range(count):
                ts = day_start + timedelta(hours=hour, minutes=random.randint(0, 59))
                transactions.append(Transaction(
                    store_id=hq.id, timestamp=ts, category=random.choice(CATEGORIES),
                    amount=round(random.uniform(15, 120), 2),
                ))
    db.add_all(transactions)
    db.commit()

    # --- Offers (customer app) ---
    offers = [
        Offer(title="20% off fresh berries", subtitle="Ends tonight", tone="green", category="Produce"),
        Offer(title="Frozen bundle deal", subtitle="Buy 2, save AED 12", tone="blue", category="Frozen"),
        Offer(title="Bakery: buy 1 get 1", subtitle="Weekends only", tone="amber", category="Bakery"),
    ]
    db.add_all(offers)
    db.commit()

    # --- Layla's shopping list + order history (so recommendations/receipts
    # have real data to compute from on first login) ---
    list_items = [
        ShoppingListItem(customer_id=layla.id, product_id=by_sku["SKU-1101"].id, quantity=1, checked=True),
        ShoppingListItem(customer_id=layla.id, product_id=by_sku["SKU-1301"].id, quantity=1, checked=True),
        ShoppingListItem(customer_id=layla.id, product_id=by_sku["SKU-1103"].id, quantity=1, checked=False),
        ShoppingListItem(customer_id=layla.id, product_id=by_sku["SKU-1002"].id, quantity=1, checked=False),
        ShoppingListItem(customer_id=layla.id, product_id=by_sku["SKU-1102"].id, quantity=1, checked=False),
    ]
    db.add_all(list_items)
    db.commit()

    past_order_skus = [
        ("SKU-1101", 2), ("SKU-1301", 1), ("SKU-1002", 1),
    ]
    order = CustomerOrder(customer_id=layla.id, store_id=hq.id, total=0.0, loyalty_points_earned=0,
                           created_at=datetime.utcnow() - timedelta(days=6))
    db.add(order)
    db.flush()
    total = 0.0
    for sku, qty in past_order_skus:
        product = by_sku[sku]
        total += product.price * qty
        db.add(CustomerOrderItem(order_id=order.id, product_id=product.id, quantity=qty, unit_price=product.price))
    order.total = round(total, 2)
    order.loyalty_points_earned = int(total)
    db.commit()

    # --- A couple of past register (cashier) sales for other loyalty
    # customers, so the Customers directory and Cashier screen have real
    # order history to show beyond Layla's self-checkout account — spread
    # across more than one store so Analytics → Profit & Loss has a real
    # cross-store comparison in Enterprise mode, not just headquarters. ---
    omar, fatima, rahul = extra_customers[0], extra_customers[1], extra_customers[2]
    riverside, north_hills = stores[1], stores[2]
    cashier_past_orders = [
        (omar, marcus, hq, "card", [("SKU-1201", 1), ("SKU-1401", 2)], 9),
        (fatima, diego, hq, "cash", [("SKU-1301", 1), ("SKU-1102", 3)], 3),
        (fatima, aisha, hq, "apple_pay", [("SKU-1001", 2)], 1),
        (rahul, priya, riverside, "card", [("SKU-1402", 1), ("SKU-1103", 1)], 5),
        (None, priya, riverside, "cash", [("SKU-1003", 3), ("SKU-1303", 2)], 2),
        (None, aisha, north_hills, "tabby", [("SKU-1201", 2), ("SKU-1202", 1)], 4),
    ]
    for customer, cashier, store, method, skus, days_ago in cashier_past_orders:
        o = CustomerOrder(
            customer_id=customer.id if customer else None, store_id=store.id, total=0.0, channel="cashier",
            cashier_id=cashier.id, payment_method=method,
            created_at=datetime.utcnow() - timedelta(days=days_ago),
        )
        db.add(o)
        db.flush()
        o_total = 0.0
        for sku, qty in skus:
            product = by_sku[sku]
            o_total += product.price * qty
            db.add(CustomerOrderItem(order_id=o.id, product_id=product.id, quantity=qty, unit_price=product.price))
        o.total = round(o_total, 2)
        o.amount_tendered = o.total
        o.change_due = 0.0
        o.loyalty_points_earned = int(o.total) if customer else 0
        if customer:
            customer.loyalty_points = (customer.loyalty_points or 0) + o.loyalty_points_earned
        db.commit()

    print(f"Seeded {len(stores)} stores, {len(suppliers)} suppliers, {len(team) + len(extra_customers)} users, "
          f"{len(products)} products, {len(tasks)} tasks, {len(sales)} sales records, "
          f"{len(zones)} warehouse zones, {len(transactions)} transactions, {len(offers)} offers.")
    db.close()


if __name__ == "__main__":
    run()
