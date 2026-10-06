"""
The starting workspace: four stores, a staff roster, suppliers, a 15-SKU catalogue with batch-level stock, 90 days
of sales history, checkout traffic and order history.

It is the same workspace the browser edition starts with (frontend/src/engine/seed.js): the same names, the same
accounts, and — because the random-number generator below is a line-for-line port of the one the browser edition
uses, drawn in the same order — the same stock levels and sales figures. Dates are relative to the moment it is
created, so "last 7 days" always means something.

    python -m app.seed          # create the tables and seed them if the database is empty

Every built-in account signs in with the password `retailmind`.
"""
import math
import secrets
from datetime import datetime, timedelta

from app.clock import utcnow
from app.database import Base, SessionLocal, engine
from app.models import (
    AccessLevel,
    Alert,
    AlertKind,
    AlertSeverity,
    Batch,
    BatchStatus,
    CustomerOrder,
    CustomerOrderItem,
    Offer,
    POStatus,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    SalesRecord,
    ShoppingListItem,
    Store,
    Supplier,
    Task,
    Transaction,
    User,
    UserRole,
    WarehouseZone,
)
from app.security import hash_password

SEED_PASSWORD = "retailmind"

CATEGORIES = ["Produce", "Dairy & Chilled", "Frozen", "Bakery", "Meat & Seafood"]

# Rough grocery-store hourly traffic shape (weights, not counts), used only to seed plausible transaction
# timestamps; congestion and staffing are computed from the rows, never from this array.
HOURLY_WEIGHTS = [0, 0, 0, 0, 0, 0, 1, 3, 5, 6, 7, 8, 10, 9, 6, 5, 6, 8, 10, 9, 6, 3, 1, 0]

_M32 = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    return (a * b) & _M32


class Rng:
    """mulberry32 with the helper methods the browser edition's seed uses. Same seed, same sequence."""

    def __init__(self, seed: int):
        self._a = seed & _M32

    def random(self) -> float:
        self._a = (self._a + 0x6D2B79F5) & _M32
        t = self._a
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ ((t + _imul(t ^ (t >> 7), t | 61)) & _M32)) & _M32
        return ((t ^ (t >> 14)) & _M32) / 4294967296

    def uniform(self, a: float, b: float) -> float:
        return a + (b - a) * self.random()

    def int(self, a: int, b: int) -> int:
        """Inclusive on both ends, like Python's random.randint."""
        return a + math.floor(self.random() * (b - a + 1))

    def gauss(self, mu: float, sigma: float) -> float:
        u = 0.0
        while u == 0:
            u = self.random()
        v = self.random()
        return mu + sigma * math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)

    def choice(self, items):
        return items[math.floor(self.random() * len(items))]


def _round_half_up(x: float) -> int:
    """JavaScript's Math.round, which the browser edition's seed uses."""
    return math.floor(x + 0.5)


def _start_of_day(moment: datetime) -> datetime:
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def clear(db) -> None:
    """Deletes every row (children before parents), leaving the tables in place."""
    for table in reversed(Base.metadata.sorted_tables):
        db.execute(table.delete())
    db.commit()


def populate(db, now: datetime | None = None) -> None:
    now = now or utcnow()
    rng = Rng(20260401)

    def at(days: float = 0, hours: float = 0, minutes: float = 0) -> datetime:
        return now + timedelta(days=days, hours=hours, minutes=minutes)

    # ---- stores ----------------------------------------------------------------------------
    store_defs = [
        ("Downtown Central", "#104", "Central", True, 1.0),
        ("Riverside Mall", "#212", "East", False, 0.55),
        ("North Hills", "#319", "North", False, 0.4),
        ("Airport Plaza", "#087", "West", False, 0.7),
    ]
    stores = [Store(name=n, code=c, region=r, is_headquarters=hq, created_at=at(-120)) for n, c, r, hq, _ in store_defs]
    db.add_all(stores)
    db.flush()
    size_of = {s.id: d[4] for s, d in zip(stores, store_defs, strict=True)}
    hq, riverside, north_hills, airport = stores

    # ---- suppliers -------------------------------------------------------------------------
    # Vendor-portal mailboxes live on the reserved-for-private-use .internal domain: valid for the forms, but nothing
    # sent there can ever reach a real inbox. The licence, VAT TRN and cold-chain fields follow UAE vendor
    # onboarding; the numbers themselves are not registered to anyone.
    supplier_defs = [
        ("Fresh Farms Co.", "Produce", 94, 97, 0, "freshfarms", "+1-555-0101", "DED-771234", "100123456700003", "Net 30", "chilled", "approved", 45),
        ("Nordic Dairy Direct", "Dairy & Chilled", 88, 91, 1, "nordicdairy", "+1-555-0102", "DED-771235", "100123456700010", "Net 30", "chilled", "approved", 12),
        ("Polar Cold Logistics", "Frozen", 96, 99, 0, "polarcold", "+1-555-0103", "DED-771236", "100123456700027", "Net 45", "frozen", "approved", 210),
        ("Golden Wheat Bakers", "Bakery", 79, 82, 2, "goldenwheat", "+1-555-0104", "DED-771237", "100123456700034", "Net 30", "ambient", "compliance_review", 90),
        ("Prime Cut Meats", "Meat & Seafood", 91, 95, 0, "primecut", "+1-555-0105", "DED-771238", "100123456700041", "Net 30", "chilled", "approved", 150),
    ]
    suppliers = [
        Supplier(
            name=name, category=category, performance_score=score, on_time_pct=on_time, late_deliveries_30d=late,
            contact_email=f"orders@{slug}.internal", contact_phone=phone, trade_license_no=licence, trn=trn,
            payment_terms=terms, cold_chain=chain, onboarding_status=status,
            contract_start=at(-365 + contract_days), contract_end=at(contract_days), created_at=at(-200),
        )
        for name, category, score, on_time, late, slug, phone, licence, trn, terms, chain, status, contract_days in supplier_defs
    ]
    db.add_all(suppliers)
    db.flush()

    # ---- people ----------------------------------------------------------------------------
    login_hash = hash_password(SEED_PASSWORD)  # one hash shared by the built-in accounts; the password is public
    no_login_hash = hash_password(secrets.token_urlsafe(24))  # members enrolled at the till have no app login

    def staff(name, email, phone, dept, title, level, store, responsibilities):
        user = User(
            name=name, email=email, phone=phone, hashed_password=login_hash, role=UserRole.employee, department=dept,
            title=title, access_level=AccessLevel(level), responsibilities=responsibilities, store_id=store.id,
            loyalty_points=0, created_at=at(-150),
        )
        db.add(user)
        return user

    approver = ["Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals"]
    marcus = staff("Marcus Tan", "marcus@retailmind.app", "+971-50-100-1001", "Store Management", "Store Incharge", "admin", hq,
                   ["Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals", "Team & Access"])
    priya = staff("Priya Sharma", "priya@retailmind.app", "+971-50-100-1002", "Inventory & Shelf Ops", "Inventory & Shelf Lead", "manager", hq,
                  ["Inventory Monitoring", "Shelf & CCTV Alerts"])
    diego = staff("Diego Ramirez", "diego@retailmind.app", "+971-50-100-1003", "Procurement & Suppliers", "Procurement Associate", "staff", hq,
                  ["Supplier Management"])
    aisha = staff("Aisha Khan", "aisha@retailmind.app", "+971-50-100-1004", "Food Safety & Quality", "Food Safety Inspector", "staff", hq,
                  ["Shelf & CCTV Alerts"])
    hana = staff("Hana Saeed", "hana@retailmind.app", "+971-50-100-1005", "Store Management", "Store Manager", "manager", riverside, approver)
    tariq = staff("Tariq Mahmoud", "tariq@retailmind.app", "+971-50-100-1006", "Store Management", "Store Manager", "manager", north_hills, approver)
    sofia = staff("Sofia Petrov", "sofia@retailmind.app", "+971-50-100-1007", "Store Management", "Store Manager", "manager", airport, approver)

    def customer(name, email, phone, points, login):
        user = User(
            name=name, email=email, phone=phone, hashed_password=login_hash if login else no_login_hash, role=UserRole.customer,
            responsibilities=[], loyalty_points=points, created_at=at(-90),
        )
        db.add(user)
        return user

    layla = customer("Layla Hassan", "layla@members.retailmind.app", "+971-55-200-2001", 1240, True)
    omar = customer("Omar Al Suwaidi", "omar.alsuwaidi@members.retailmind.app", "+971-55-200-2002", 860, False)
    fatima = customer("Fatima Al Zaabi", "fatima.alzaabi@members.retailmind.app", "+971-55-200-2003", 2130, False)
    rahul = customer("Rahul Menon", "rahul.menon@members.retailmind.app", "+971-55-200-2004", 310, False)
    customer("Noora Hassan", "noora.hassan@members.retailmind.app", "+971-55-200-2005", 45, False)
    db.flush()

    # ---- catalogue -------------------------------------------------------------------------
    # sku, barcode, name, category, unit, price, supplier index, aisle, nutrition, allergens, tags
    catalogue = [
        ("SKU-1001", "8901000000011", "Gala Apples (kg)", "Produce", "kg", 8.9, 0, "Aisle 02 · Row A", {"kcal": 52, "carbs_g": 14, "fiber_g": 2.4, "protein_g": 0.3}, [], ["Gluten-free", "Vegan"]),
        ("SKU-1002", "8901000000028", "Baby Spinach (200g)", "Produce", "each", 6.5, 0, "Aisle 02 · Row B", {"kcal": 23, "carbs_g": 3.6, "fiber_g": 2.2, "protein_g": 2.9}, [], ["Gluten-free", "Vegan", "Keto-friendly"]),
        ("SKU-1003", "8901000000035", "Ripe Bananas (kg)", "Produce", "kg", 4.2, 0, "Aisle 02 · Row C", {"kcal": 89, "carbs_g": 23, "fiber_g": 2.6, "protein_g": 1.1}, [], ["Gluten-free", "Vegan"]),
        ("SKU-1101", "8901000001018", "Whole Milk (2L)", "Dairy & Chilled", "each", 12.5, 1, "Aisle 05 · Row B", {"kcal": 61, "carbs_g": 4.8, "fat_g": 3.3, "protein_g": 3.2}, ["milk"], []),
        ("SKU-1102", "8901000001025", "Greek Yogurt (500g)", "Dairy & Chilled", "each", 11.9, 1, "Aisle 05 · Row A", {"kcal": 97, "carbs_g": 3.9, "fat_g": 5, "protein_g": 9}, ["milk"], ["High-protein"]),
        ("SKU-1103", "8901000001032", "Free-range Eggs (12)", "Dairy & Chilled", "each", 14.5, 1, "Aisle 05 · Row C", {"kcal": 155, "carbs_g": 1.1, "fat_g": 11, "protein_g": 13}, ["egg"], ["Free-range"]),
        ("SKU-1201", "8901000002015", "Frozen Peas (1kg)", "Frozen", "each", 6.2, 2, "Aisle 08 · Row A", {"kcal": 81, "carbs_g": 14, "fiber_g": 5, "protein_g": 5}, [], ["Vegan", "Gluten-free"]),
        ("SKU-1202", "8901000002022", "Frozen Mixed Berries (500g)", "Frozen", "each", 9.8, 2, "Aisle 08 · Row B", {"kcal": 57, "carbs_g": 14, "fiber_g": 3, "protein_g": 0.7}, [], ["Vegan", "Gluten-free", "No added sugar"]),
        ("SKU-1203", "8901000002039", "Frozen Margherita Pizza", "Frozen", "each", 8.5, 2, "Aisle 08 · Row C", {"kcal": 249, "carbs_g": 33, "fat_g": 9, "protein_g": 11}, ["milk", "gluten"], []),
        ("SKU-1301", "8901000003012", "Sourdough Loaf", "Bakery", "each", 9.9, 3, "Aisle 11 · Tray 4", {"kcal": 289, "carbs_g": 57, "fiber_g": 2.9, "protein_g": 10}, ["gluten"], []),
        ("SKU-1302", "8901000003029", "Croissants (4-pack)", "Bakery", "each", 10.5, 3, "Aisle 11 · Tray 2", {"kcal": 406, "carbs_g": 45, "fat_g": 21, "protein_g": 8}, ["gluten", "milk", "egg"], []),
        ("SKU-1303", "8901000003036", "Multigrain Bread", "Bakery", "each", 8.9, 3, "Aisle 11 · Tray 1", {"kcal": 265, "carbs_g": 43, "fiber_g": 6, "protein_g": 11}, ["gluten"], ["High-fiber"]),
        ("SKU-1401", "8901000004019", "Ground Beef (kg)", "Meat & Seafood", "kg", 34.0, 4, "Aisle 14 · Row A", {"kcal": 250, "carbs_g": 0, "fat_g": 17, "protein_g": 26}, [], ["High-protein"]),
        ("SKU-1402", "8901000004026", "Atlantic Salmon Fillet (kg)", "Meat & Seafood", "kg", 48.0, 4, "Aisle 14 · Row B", {"kcal": 208, "carbs_g": 0, "fat_g": 13, "protein_g": 20}, ["fish"], ["High-protein", "Omega-3"]),
        ("SKU-1403", "8901000004033", "Chicken Breast (kg)", "Meat & Seafood", "kg", 28.5, 4, "Aisle 14 · Row C", {"kcal": 165, "carbs_g": 0, "fat_g": 3.6, "protein_g": 31}, [], ["High-protein", "Low-fat"]),
    ]
    # Reorder points that can realistically trip against 10-300 unit lots, and category gross margins in line with
    # UAE hypermarket benchmarks (bakery richest, meat and seafood thinnest); cost_price = price x (1 - margin) is
    # what makes Profit & Loss a real margin computation.
    reorder_by_category = {"Produce": 60, "Dairy & Chilled": 70, "Frozen": 25, "Bakery": 55, "Meat & Seafood": 40}
    margin_by_category = {"Produce": 0.3, "Dairy & Chilled": 0.24, "Frozen": 0.3, "Bakery": 0.5, "Meat & Seafood": 0.2}

    aisles: dict[str, str] = {}
    products = []
    for sku, barcode, name, category, unit, price, supplier_index, aisle, nutrition, allergens, tags in catalogue:
        aisles[sku] = aisle
        products.append(Product(
            sku=sku, barcode=barcode, name=name, category=category, unit=unit, price=price,
            cost_price=round(price * (1 - margin_by_category[category]), 2), supplier_id=suppliers[supplier_index].id,
            reorder_threshold=reorder_by_category[category], nutrition=nutrition, allergens=allergens, dietary_tags=tags,
            created_at=at(-180),
        ))
    db.add_all(products)
    db.flush()
    by_sku = {p.sku: p for p in products}

    # ---- stock: one received lot per product per store (the FEFO unit) ------------------------
    # On-hand is set relative to each product's own reorder point (0.3x to 6x), so most shelves look healthy and a
    # realistic handful sit below it. Smaller formats stock a little less.
    def stock_scale(size: float) -> float:
        return 0.5 + 0.5 * size

    for store in stores:
        scale = stock_scale(size_of[store.id])
        for i, product in enumerate(products):
            quantity = max(4, _round_half_up(product.reorder_threshold * rng.uniform(0.3, 6) * scale))
            received = at(-rng.int(1, 6))
            expires = at(rng.int(1, 20))
            suffix = "" if store is hq else f"-{store.code[1:]}"
            db.add(Batch(
                product_id=product.id, store_id=store.id, lot_number=f"LOT-{1000 + i}{suffix}", quantity=quantity,
                aisle_location=aisles[product.sku], received_at=received, expires_at=expires, status=BatchStatus.active,
            ))
    # One written-off bakery lot (matches the quality flag below) so waste-by-category has a real figure.
    db.add(Batch(
        product_id=by_sku["SKU-1302"].id, store_id=hq.id, lot_number="LOT-2291", quantity=18, aisle_location="Aisle 11 · Tray 2",
        received_at=at(-5), expires_at=at(-1), status=BatchStatus.removed,
    ))

    # ---- alerts ----------------------------------------------------------------------------
    def alert(store, kind, severity, source, location, message, confidence, assignee, minutes_ago):
        db.add(Alert(
            store_id=store.id, kind=AlertKind(kind), severity=AlertSeverity(severity), model_source=source, location=location,
            message=message, confidence=confidence, assigned_to=assignee.id, created_at=at(0, 0, -minutes_ago),
        ))

    alert(hq, "stock", "amber", "YOLO + SAM", "Aisle 05 · Dairy, Row B", "Shelf space 88% empty — Whole Milk running under par", 96, priya, 42)
    alert(hq, "theft", "red", "YOLO + ViT", "Checkout Zone · Lane 3", "Concealment gesture pattern flagged — item moved to bag without scan", 84, marcus, 17)
    alert(hq, "quality", "amber", "ViT", "Aisle 11 · Bakery, Tray 2", "Freshness score dropped on Croissants — visual browning detected", 91, aisha, 65)
    alert(riverside, "stock", "amber", "YOLO + SAM", "Aisle 02 · Produce, Row B", "Shelf space 71% empty — Baby Spinach running under par", 93, hana, 28)
    alert(north_hills, "quality", "amber", "ViT", "Aisle 08 · Frozen, Row A", "Frost build-up detected on Frozen Peas — check the freezer seal", 88, tariq, 51)
    alert(airport, "theft", "red", "YOLO + ViT", "Entrance · Gate 2", "Repeated bag-drop pattern near the exit — review the footage", 79, sofia, 12)

    # ---- purchase orders -------------------------------------------------------------------
    def purchase_order(number, supplier, store, total, need_by_days, confidence, lines):
        order = PurchaseOrder(
            po_number=number, supplier_id=supplier.id, store_id=store.id, status=POStatus.draft, total_cost=total,
            need_by=at(need_by_days), created_from="forecast", forecast_confidence=confidence, created_at=at(0, -3),
        )
        order.items = [PurchaseOrderItem(product_id=by_sku[sku].id, quantity=quantity, unit_cost=unit_cost) for sku, quantity, unit_cost in lines]
        db.add(order)

    purchase_order("PO-1042", suppliers[1], hq, 3180, 2, 0.94, [("SKU-1101", 340, 9.35)])
    purchase_order("PO-1043", suppliers[0], riverside, 1240, 3, 0.89, [("SKU-1002", 190, 4.55), ("SKU-1001", 40, 6.23)])
    purchase_order("PO-1044", suppliers[2], north_hills, 880, 4, 0.91, [("SKU-1201", 140, 4.34)])
    purchase_order("PO-1045", suppliers[4], airport, 2150, 2, 0.87, [("SKU-1403", 75, 22.8), ("SKU-1401", 14, 27.2)])

    # ---- tasks -----------------------------------------------------------------------------
    def task(store, assignee, title, detail, source, done, minutes_ago):
        db.add(Task(store_id=store.id, assigned_to=assignee.id, title=title, detail=detail, source=source, done=done, created_at=at(0, 0, -minutes_ago)))

    task(hq, priya, "Restock Aisle 05 · Dairy Row B", "Whole Milk — shelf 88% empty", "Shelf monitoring", False, 60)
    task(hq, diego, "Approve delivery — Fresh Farms Co.", "Produce · ETA 2:30 PM · 340kg", "Supplier schedule", False, 55)
    task(hq, aisha, "Quality check — Bakery batch #2291", "Freshness score flagged for review", "Quality inspection", False, 50)
    task(hq, marcus, "Review CCTV flag — Checkout Lane 3", "Concealment pattern, 84% confidence", "Loss prevention", False, 45)
    task(hq, priya, "Restock Aisle 02 · Produce Bin 3", "Crate count below par", "Shelf monitoring", True, 40)
    task(hq, marcus, "Review purchase order PO-1042", "AED 3,180 · AI-drafted from Forecast Studio", "Procurement", False, 35)
    task(riverside, hana, "Restock Aisle 02 · Produce Row B", "Baby Spinach — shelf 71% empty", "Shelf monitoring", False, 30)
    task(riverside, hana, "Review purchase order PO-1043", "AED 1,240 · AI-drafted from Forecast Studio", "Procurement", False, 25)
    task(north_hills, tariq, "Inspect Aisle 08 freezer seal", "Frost build-up on Frozen Peas", "Quality inspection", False, 30)
    task(airport, sofia, "Review CCTV flag — Entrance Gate 2", "Bag-drop pattern, 79% confidence", "Loss prevention", False, 20)
    db.flush()

    # ---- sales history: 90 days x every store x every category ------------------------------
    # Smaller formats undersell the flagship by a realistic multiplier rather than mirroring it.
    base_units = {"Produce": 420, "Dairy & Chilled": 260, "Frozen": 180, "Bakery": 150, "Meat & Seafood": 210}
    sales = []
    for store in stores:
        size = size_of[store.id]
        for category in CATEGORIES:
            base = base_units[category] * size
            for d in range(90, 0, -1):
                date = _start_of_day(now - timedelta(days=d))
                weekend = date.weekday() >= 5
                units = max(0, int(base + rng.gauss(0, base * 0.12) + (40 * size if weekend else 0)))
                revenue = round(units * rng.uniform(3.5, 6.5), 2)
                promo = rng.random() < 0.1
                temperature = round(rng.uniform(18, 38), 1)
                event = rng.random() < 0.05
                sales.append(SalesRecord(
                    store_id=store.id, category=category, date=date, units_sold=units, revenue=revenue, promo_flag=promo,
                    temperature_c=temperature, is_holiday=False, local_event_flag=event,
                ))
    db.bulk_save_objects(sales)

    # ---- warehouse zones (utilisation is computed live from stock, never stored) ------------
    zone_defs = [
        ("Zone A · Dry Goods & Produce", ["Bakery", "Produce"], 1400),
        ("Zone B · Cold Storage", ["Dairy & Chilled", "Meat & Seafood"], 1400),
        ("Zone C · Frozen", ["Frozen"], 420),
        ("Zone D · Receiving & Staging", [], 500),
    ]
    for store in stores:
        for i, (name, categories, capacity) in enumerate(zone_defs):
            db.add(WarehouseZone(
                store_id=store.id, name=name, categories=categories, capacity_units=_round_half_up(capacity * stock_scale(size_of[store.id])), sort_order=i + 1,
            ))

    # ---- checkout traffic: 21 days of hour-weighted transactions, per store -----------------
    transactions = []
    for store in stores:
        size = size_of[store.id]
        for d in range(21, 0, -1):
            day_start = _start_of_day(now - timedelta(days=d))
            dow = day_start.weekday()
            weekend_mult = 1.5 if dow == 5 else 1.2 if dow == 6 else 1.0
            for hour, weight in enumerate(HOURLY_WEIGHTS):
                count = _round_half_up(weight * weekend_mult * size * rng.uniform(0.7, 1.3))
                for _ in range(count):
                    minute = rng.int(0, 59)
                    category = rng.choice(CATEGORIES)
                    amount = round(rng.uniform(15, 120), 2)
                    transactions.append(Transaction(
                        store_id=store.id, timestamp=day_start + timedelta(hours=hour, minutes=minute), category=category, amount=amount,
                    ))
    db.bulk_save_objects(transactions)

    # ---- offers ----------------------------------------------------------------------------
    db.add_all([
        Offer(title="20% off fresh berries", subtitle="Ends tonight", tone="green", category="Produce", active=True, starts_at=at(-2), ends_at=None),
        Offer(title="Frozen bundle deal", subtitle="Buy 2, save AED 12", tone="blue", category="Frozen", active=True, starts_at=at(-2), ends_at=None),
        Offer(title="Bakery: buy 1 get 1", subtitle="Weekends only", tone="amber", category="Bakery", active=True, starts_at=at(-2), ends_at=None),
    ])

    # ---- Layla's list and history, so receipts and recommendations have real data ------------
    for i, (sku, checked) in enumerate([("SKU-1101", True), ("SKU-1301", True), ("SKU-1103", False), ("SKU-1002", False), ("SKU-1102", False)]):
        db.add(ShoppingListItem(customer_id=layla.id, product_id=by_sku[sku].id, quantity=1, checked=checked, added_at=at(-1, 0, i)))

    def place_order(who, cashier, store, method, lines, days_ago, channel):
        total = 0.0
        items = []
        for sku, quantity in lines:
            total += by_sku[sku].price * quantity
            items.append(CustomerOrderItem(product_id=by_sku[sku].id, quantity=quantity, unit_price=by_sku[sku].price))
        total = round(total, 2)
        points = int(total) if who else 0
        if who and channel == "cashier":
            who.loyalty_points += points
        order = CustomerOrder(
            customer_id=who.id if who else None, store_id=store.id, total=total, loyalty_points_earned=points, points_redeemed=0, channel=channel,
            cashier_id=cashier.id if cashier else None, payment_method=method, amount_tendered=total if channel == "cashier" else None,
            change_due=0.0 if channel == "cashier" else None, created_at=at(-days_ago, -rng.int(0, 5)),
        )
        order.items = items
        db.add(order)

    place_order(layla, None, hq, None, [("SKU-1101", 2), ("SKU-1301", 1), ("SKU-1002", 1)], 6, "self_checkout")
    for who, cashier, store, method, lines, days_ago in [
        (omar, marcus, hq, "card", [("SKU-1201", 1), ("SKU-1401", 2)], 9),
        (fatima, diego, hq, "cash", [("SKU-1301", 1), ("SKU-1102", 3)], 3),
        (fatima, aisha, hq, "apple_pay", [("SKU-1001", 2)], 1),
        (rahul, priya, riverside, "card", [("SKU-1402", 1), ("SKU-1103", 1)], 5),
        (None, priya, riverside, "cash", [("SKU-1003", 3), ("SKU-1303", 2)], 2),
        (None, aisha, north_hills, "tabby", [("SKU-1201", 2), ("SKU-1202", 1)], 4),
    ]:
        place_order(who, cashier, store, method, lines, days_ago, "cashier")

    db.commit()


def run() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(Store).first():
            print("Database already seeded — skipping. Drop the tables (or call app.seed.clear) to start over.")
            return
        populate(db)
        print(
            f"Seeded {db.query(Store).count()} stores, {db.query(Supplier).count()} suppliers, {db.query(User).count()} users, "
            f"{db.query(Product).count()} products, {db.query(Task).count()} tasks, {db.query(SalesRecord).count()} sales records, "
            f"{db.query(WarehouseZone).count()} warehouse zones, {db.query(Transaction).count()} transactions, {db.query(Offer).count()} offers."
        )
    finally:
        db.close()


if __name__ == "__main__":
    run()
