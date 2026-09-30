// First-run workspace data: four stores, a staff roster, suppliers, a 15-SKU catalogue with
// batch-level stock, 90 days of sales history, checkout traffic and order history. Deterministic
// (seeded PRNG) so a fresh workspace is reproducible; dates are relative to first launch.
import { SEED_PASSWORD } from "./accounts.js";
import { CATEGORIES, HOURLY_WEIGHTS } from "./constants.js";
import { hashPassword, randomSecret } from "./crypto.js";
import { emptyState } from "./store.js";
import { DAY, HOUR, createRng, pyRound, pyWeekday, startOfUtcDay } from "./util.js";

const MINUTE = 60_000;

export async function seedWorkspace(db, now = Date.now()) {
  const fresh = emptyState();
  db.load(fresh);
  db.meta.jwtSecret = randomSecret();
  db.meta.seededAt = now;
  db.meta.clockDay = startOfUtcDay(now);

  const rng = createRng(20260401);
  const at = (days = 0, hours = 0, minutes = 0) => now + days * DAY + hours * HOUR + minutes * MINUTE;

  // ---- stores -------------------------------------------------------------------------
  const storeDefs = [
    { name: "Downtown Central", code: "#104", region: "Central", is_headquarters: true, size: 1.0 },
    { name: "Riverside Mall", code: "#212", region: "East", is_headquarters: false, size: 0.55 },
    { name: "North Hills", code: "#319", region: "North", is_headquarters: false, size: 0.4 },
    { name: "Airport Plaza", code: "#087", region: "West", is_headquarters: false, size: 0.7 },
  ];
  const stores = storeDefs.map((s) =>
    db.insert("stores", { name: s.name, code: s.code, region: s.region, is_headquarters: s.is_headquarters, created_at: at(-120) }),
  );
  const sizeOf = Object.fromEntries(stores.map((s, i) => [s.id, storeDefs[i].size]));
  const [hq, riverside, northHills, airport] = stores;

  // ---- suppliers ----------------------------------------------------------------------
  // Vendor-portal mailboxes live on the reserved-for-private-use .internal TLD: valid for the
  // forms, but nothing sent there can ever reach a real inbox. Trade licence / TRN numbers are
  // fictional formats modelled on UAE vendor onboarding (licence, VAT TRN, cold-chain disclosure).
  const supplierDefs = [
    ["Fresh Farms Co.", "Produce", 94, 97, 0, "freshfarms", "+1-555-0101", "DED-771234", "100123456700003", "Net 30", "chilled", "approved", 45],
    ["Nordic Dairy Direct", "Dairy & Chilled", 88, 91, 1, "nordicdairy", "+1-555-0102", "DED-771235", "100123456700010", "Net 30", "chilled", "approved", 12],
    ["Polar Cold Logistics", "Frozen", 96, 99, 0, "polarcold", "+1-555-0103", "DED-771236", "100123456700027", "Net 45", "frozen", "approved", 210],
    ["Golden Wheat Bakers", "Bakery", 79, 82, 2, "goldenwheat", "+1-555-0104", "DED-771237", "100123456700034", "Net 30", "ambient", "compliance_review", 90],
    ["Prime Cut Meats", "Meat & Seafood", 91, 95, 0, "primecut", "+1-555-0105", "DED-771238", "100123456700041", "Net 30", "chilled", "approved", 150],
  ];
  const suppliers = supplierDefs.map(([name, category, score, onTime, late, slug, phone, licence, trn, terms, chain, status, contractDays]) =>
    db.insert("suppliers", {
      name, category, performance_score: score, on_time_pct: onTime, late_deliveries_30d: late,
      contact_email: `orders@${slug}.internal`, contact_phone: phone, trade_license_no: licence, trn,
      payment_terms: terms, cold_chain: chain, onboarding_status: status,
      contract_start: at(-365 + contractDays), contract_end: at(contractDays), created_at: at(-200),
    }),
  );

  // ---- people -------------------------------------------------------------------------
  const passwordHashes = await Promise.all(Array.from({ length: 8 }, () => hashPassword(SEED_PASSWORD)));
  let hashIndex = 0;
  const staff = (name, email, phone, dept, title, level, store, responsibilities) =>
    db.insert("users", {
      name, email, phone, hashed_password: passwordHashes[hashIndex++], role: "employee", department: dept, title,
      access_level: level, responsibilities, store_id: store.id, loyalty_points: 0, preferred_store_id: null,
      notify_restock: true, notify_security: true, notify_orders: true, created_at: at(-150),
    });

  const marcus = staff("Marcus Tan", "marcus@retailmind.app", "+971-50-100-1001", "Store Management", "Store Incharge", "admin", hq,
    ["Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals", "Team & Access"]);
  const priya = staff("Priya Sharma", "priya@retailmind.app", "+971-50-100-1002", "Inventory & Shelf Ops", "Inventory & Shelf Lead", "manager", hq,
    ["Inventory Monitoring", "Shelf & CCTV Alerts"]);
  const diego = staff("Diego Ramirez", "diego@retailmind.app", "+971-50-100-1003", "Procurement & Suppliers", "Procurement Associate", "staff", hq,
    ["Supplier Management"]);
  const aisha = staff("Aisha Khan", "aisha@retailmind.app", "+971-50-100-1004", "Food Safety & Quality", "Food Safety Inspector", "staff", hq,
    ["Shelf & CCTV Alerts"]);
  const hana = staff("Hana Saeed", "hana@retailmind.app", "+971-50-100-1005", "Store Management", "Store Manager", "manager", riverside,
    ["Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals"]);
  const tariq = staff("Tariq Mahmoud", "tariq@retailmind.app", "+971-50-100-1006", "Store Management", "Store Manager", "manager", northHills,
    ["Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals"]);
  const sofia = staff("Sofia Petrov", "sofia@retailmind.app", "+971-50-100-1007", "Store Management", "Store Manager", "manager", airport,
    ["Inventory Monitoring", "Shelf & CCTV Alerts", "Purchase Approvals"]);

  const customer = (name, email, phone, points, login) =>
    db.insert("users", {
      name, email, phone, hashed_password: login ? passwordHashes[hashIndex++] : null, role: "customer",
      department: null, title: null, access_level: null, responsibilities: [], store_id: null, loyalty_points: points,
      preferred_store_id: null, notify_restock: true, notify_security: true, notify_orders: true, created_at: at(-90),
    });
  const layla = customer("Layla Hassan", "layla@members.retailmind.app", "+971-55-200-2001", 1240, true);
  // In-store loyalty enrolments: real member records with no app login, exactly what a register
  // quick-enrol produces.
  const omar = customer("Omar Al Suwaidi", "omar.alsuwaidi@members.retailmind.app", "+971-55-200-2002", 860, false);
  const fatima = customer("Fatima Al Zaabi", "fatima.alzaabi@members.retailmind.app", "+971-55-200-2003", 2130, false);
  const rahul = customer("Rahul Menon", "rahul.menon@members.retailmind.app", "+971-55-200-2004", 310, false);
  customer("Noora Hassan", "noora.hassan@members.retailmind.app", "+971-55-200-2005", 45, false);

  // ---- catalogue ----------------------------------------------------------------------
  // [sku, barcode, name, category, unit, price, supplier index, aisle, nutrition, allergens, tags]
  const catalogue = [
    ["SKU-1001", "8901000000011", "Gala Apples (kg)", "Produce", "kg", 8.9, 0, "Aisle 02 · Row A", { kcal: 52, carbs_g: 14, fiber_g: 2.4, protein_g: 0.3 }, [], ["Gluten-free", "Vegan"]],
    ["SKU-1002", "8901000000028", "Baby Spinach (200g)", "Produce", "each", 6.5, 0, "Aisle 02 · Row B", { kcal: 23, carbs_g: 3.6, fiber_g: 2.2, protein_g: 2.9 }, [], ["Gluten-free", "Vegan", "Keto-friendly"]],
    ["SKU-1003", "8901000000035", "Ripe Bananas (kg)", "Produce", "kg", 4.2, 0, "Aisle 02 · Row C", { kcal: 89, carbs_g: 23, fiber_g: 2.6, protein_g: 1.1 }, [], ["Gluten-free", "Vegan"]],
    ["SKU-1101", "8901000001018", "Whole Milk (2L)", "Dairy & Chilled", "each", 12.5, 1, "Aisle 05 · Row B", { kcal: 61, carbs_g: 4.8, fat_g: 3.3, protein_g: 3.2 }, ["milk"], []],
    ["SKU-1102", "8901000001025", "Greek Yogurt (500g)", "Dairy & Chilled", "each", 11.9, 1, "Aisle 05 · Row A", { kcal: 97, carbs_g: 3.9, fat_g: 5, protein_g: 9 }, ["milk"], ["High-protein"]],
    ["SKU-1103", "8901000001032", "Free-range Eggs (12)", "Dairy & Chilled", "each", 14.5, 1, "Aisle 05 · Row C", { kcal: 155, carbs_g: 1.1, fat_g: 11, protein_g: 13 }, ["egg"], ["Free-range"]],
    ["SKU-1201", "8901000002015", "Frozen Peas (1kg)", "Frozen", "each", 6.2, 2, "Aisle 08 · Row A", { kcal: 81, carbs_g: 14, fiber_g: 5, protein_g: 5 }, [], ["Vegan", "Gluten-free"]],
    ["SKU-1202", "8901000002022", "Frozen Mixed Berries (500g)", "Frozen", "each", 9.8, 2, "Aisle 08 · Row B", { kcal: 57, carbs_g: 14, fiber_g: 3, protein_g: 0.7 }, [], ["Vegan", "Gluten-free", "No added sugar"]],
    ["SKU-1203", "8901000002039", "Frozen Margherita Pizza", "Frozen", "each", 8.5, 2, "Aisle 08 · Row C", { kcal: 249, carbs_g: 33, fat_g: 9, protein_g: 11 }, ["milk", "gluten"], []],
    ["SKU-1301", "8901000003012", "Sourdough Loaf", "Bakery", "each", 9.9, 3, "Aisle 11 · Tray 4", { kcal: 289, carbs_g: 57, fiber_g: 2.9, protein_g: 10 }, ["gluten"], []],
    ["SKU-1302", "8901000003029", "Croissants (4-pack)", "Bakery", "each", 10.5, 3, "Aisle 11 · Tray 2", { kcal: 406, carbs_g: 45, fat_g: 21, protein_g: 8 }, ["gluten", "milk", "egg"], []],
    ["SKU-1303", "8901000003036", "Multigrain Bread", "Bakery", "each", 8.9, 3, "Aisle 11 · Tray 1", { kcal: 265, carbs_g: 43, fiber_g: 6, protein_g: 11 }, ["gluten"], ["High-fiber"]],
    ["SKU-1401", "8901000004019", "Ground Beef (kg)", "Meat & Seafood", "kg", 34.0, 4, "Aisle 14 · Row A", { kcal: 250, carbs_g: 0, fat_g: 17, protein_g: 26 }, [], ["High-protein"]],
    ["SKU-1402", "8901000004026", "Atlantic Salmon Fillet (kg)", "Meat & Seafood", "kg", 48.0, 4, "Aisle 14 · Row B", { kcal: 208, carbs_g: 0, fat_g: 13, protein_g: 20 }, ["fish"], ["High-protein", "Omega-3"]],
    ["SKU-1403", "8901000004033", "Chicken Breast (kg)", "Meat & Seafood", "kg", 28.5, 4, "Aisle 14 · Row C", { kcal: 165, carbs_g: 0, fat_g: 3.6, protein_g: 31 }, [], ["High-protein", "Low-fat"]],
  ];
  // Reorder points that can realistically trip against 10-300 unit lots, and category gross
  // margins in line with UAE hypermarket benchmarks (bakery richest, meat & seafood thinnest);
  // cost_price = price × (1 − margin) is what makes Profit & Loss a real margin computation.
  const reorderByCategory = { Produce: 60, "Dairy & Chilled": 70, Frozen: 25, Bakery: 55, "Meat & Seafood": 40 };
  const marginByCategory = { Produce: 0.3, "Dairy & Chilled": 0.24, Frozen: 0.3, Bakery: 0.5, "Meat & Seafood": 0.2 };

  const aisles = {};
  const products = catalogue.map(([sku, barcode, name, category, unit, price, supplierIndex, aisle, nutrition, allergens, tags]) => {
    aisles[sku] = aisle;
    return db.insert("products", {
      sku, barcode, name, category, unit, price, cost_price: pyRound(price * (1 - marginByCategory[category]), 2),
      supplier_id: suppliers[supplierIndex].id, reorder_threshold: reorderByCategory[category],
      nutrition, allergens, dietary_tags: tags, created_at: at(-180),
    });
  });
  const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

  // ---- stock: one received lot per product per store (FEFO unit) -------------------------
  for (const store of stores) {
    const size = sizeOf[store.id];
    products.forEach((p, i) => {
      db.insert("batches", {
        product_id: p.id, store_id: store.id, lot_number: `LOT-${1000 + i}${store === hq ? "" : `-${store.code.slice(1)}`}`,
        quantity: Math.max(6, Math.round(rng.int(10, 300) * size)), aisle_location: aisles[p.sku],
        received_at: at(-rng.int(1, 6)), expires_at: at(rng.int(1, 20)), status: "active",
      });
    });
  }
  // One written-off bakery lot (matches the quality flag below) so waste-by-category has a real figure.
  db.insert("batches", {
    product_id: bySku["SKU-1302"].id, store_id: hq.id, lot_number: "LOT-2291", quantity: 18, aisle_location: "Aisle 11 · Tray 2",
    received_at: at(-5), expires_at: at(-1), status: "removed",
  });

  // ---- alerts -------------------------------------------------------------------------
  const alert = (store, kind, severity, source, location, message, confidence, assignee, minutesAgo) =>
    db.insert("alerts", {
      store_id: store.id, kind, severity, model_source: source, location, message, confidence, status: "open",
      assigned_to: assignee.id, created_at: at(0, 0, -minutesAgo), resolved_at: null,
    });
  alert(hq, "stock", "amber", "YOLO + SAM", "Aisle 05 · Dairy, Row B", "Shelf space 88% empty — Whole Milk running under par", 96, priya, 42);
  alert(hq, "theft", "red", "YOLO + ViT", "Checkout Zone · Lane 3", "Concealment gesture pattern flagged — item moved to bag without scan", 84, marcus, 17);
  alert(hq, "quality", "amber", "ViT", "Aisle 11 · Bakery, Tray 2", "Freshness score dropped on Croissants — visual browning detected", 91, aisha, 65);
  alert(riverside, "stock", "amber", "YOLO + SAM", "Aisle 02 · Produce, Row B", "Shelf space 71% empty — Baby Spinach running under par", 93, hana, 28);
  alert(northHills, "quality", "amber", "ViT", "Aisle 08 · Frozen, Row A", "Frost build-up detected on Frozen Peas — check the freezer seal", 88, tariq, 51);
  alert(airport, "theft", "red", "YOLO + ViT", "Entrance · Gate 2", "Repeated bag-drop pattern near the exit — review the footage", 79, sofia, 12);

  // ---- purchase orders ----------------------------------------------------------------
  const purchaseOrder = (number, supplier, store, total, needByDays, confidence, lines) =>
    db.insert("purchase_orders", {
      po_number: number, supplier_id: supplier.id, store_id: store.id, status: "draft", total_cost: total,
      need_by: at(needByDays), created_from: "forecast", forecast_confidence: confidence, created_at: at(0, -3),
      approved_by: null, approved_at: null,
      items: lines.map(([sku, quantity, unitCost]) => ({ product_id: bySku[sku].id, quantity, unit_cost: unitCost })),
    });
  purchaseOrder("PO-1042", suppliers[1], hq, 3180, 2, 0.94, [["SKU-1101", 340, 9.35]]);
  purchaseOrder("PO-1043", suppliers[0], riverside, 1240, 3, 0.89, [["SKU-1002", 190, 4.55], ["SKU-1001", 40, 6.23]]);
  purchaseOrder("PO-1044", suppliers[2], northHills, 880, 4, 0.91, [["SKU-1201", 140, 4.34]]);
  purchaseOrder("PO-1045", suppliers[4], airport, 2150, 2, 0.87, [["SKU-1403", 75, 22.8], ["SKU-1401", 14, 27.2]]);

  // ---- tasks --------------------------------------------------------------------------
  const task = (store, assignee, title, detail, source, done, minutesAgo) =>
    db.insert("tasks", { store_id: store.id, assigned_to: assignee.id, title, detail, source, done, created_at: at(0, 0, -minutesAgo) });
  task(hq, priya, "Restock Aisle 05 · Dairy Row B", "Whole Milk — shelf 88% empty", "Shelf monitoring", false, 60);
  task(hq, diego, "Approve delivery — Fresh Farms Co.", "Produce · ETA 2:30 PM · 340kg", "Supplier schedule", false, 55);
  task(hq, aisha, "Quality check — Bakery batch #2291", "Freshness score flagged for review", "Quality inspection", false, 50);
  task(hq, marcus, "Review CCTV flag — Checkout Lane 3", "Concealment pattern, 84% confidence", "Loss prevention", false, 45);
  task(hq, priya, "Restock Aisle 02 · Produce Bin 3", "Crate count below par", "Shelf monitoring", true, 40);
  task(hq, marcus, "Review purchase order PO-1042", "AED 3,180 · AI-drafted from Forecast Studio", "Procurement", false, 35);
  task(riverside, hana, "Restock Aisle 02 · Produce Row B", "Baby Spinach — shelf 71% empty", "Shelf monitoring", false, 30);
  task(riverside, hana, "Review purchase order PO-1043", "AED 1,240 · AI-drafted from Forecast Studio", "Procurement", false, 25);
  task(northHills, tariq, "Inspect Aisle 08 freezer seal", "Frost build-up on Frozen Peas", "Quality inspection", false, 30);
  task(airport, sofia, "Review CCTV flag — Entrance Gate 2", "Bag-drop pattern, 79% confidence", "Loss prevention", false, 20);

  // ---- sales history: 90 days × every store × every category --------------------------
  // Smaller formats undersell the flagship by a realistic multiplier rather than mirroring it.
  const baseUnits = { Produce: 420, "Dairy & Chilled": 260, Frozen: 180, Bakery: 150, "Meat & Seafood": 210 };
  for (const store of stores) {
    const size = sizeOf[store.id];
    for (const category of CATEGORIES) {
      const base = baseUnits[category] * size;
      for (let d = 90; d >= 1; d--) {
        const date = startOfUtcDay(now - d * DAY);
        const weekend = pyWeekday(date) >= 5;
        const units = Math.max(0, Math.trunc(base + rng.gauss(0, base * 0.12) + (weekend ? 40 * size : 0)));
        db.insert("sales_records", {
          store_id: store.id, category, date, units_sold: units, revenue: pyRound(units * rng.uniform(3.5, 6.5), 2),
          promo_flag: rng.random() < 0.1, temperature_c: pyRound(rng.uniform(18, 38), 1), is_holiday: false,
          local_event_flag: rng.random() < 0.05,
        });
      }
    }
  }

  // ---- warehouse zones (utilisation is computed live from stock, never stored) -----------
  const zoneDefs = [
    ["Zone A · Dry Goods & Produce", ["Bakery", "Produce"], 1100],
    ["Zone B · Cold Storage", ["Dairy & Chilled", "Meat & Seafood"], 1100],
    ["Zone C · Frozen", ["Frozen"], 550],
    ["Zone D · Receiving & Staging", [], 500],
  ];
  for (const store of stores) {
    zoneDefs.forEach(([name, categories, capacity], i) => {
      db.insert("warehouse_zones", {
        store_id: store.id, name, categories, capacity_units: Math.round(capacity * sizeOf[store.id]), sort_order: i + 1,
      });
    });
  }

  // ---- checkout traffic: 21 days of hour-weighted transactions, per store ---------------
  for (const store of stores) {
    const size = sizeOf[store.id];
    for (let d = 21; d >= 1; d--) {
      const dayStart = startOfUtcDay(now - d * DAY);
      const dow = pyWeekday(dayStart);
      const weekendMult = dow === 5 ? 1.5 : dow === 6 ? 1.2 : 1.0;
      HOURLY_WEIGHTS.forEach((weight, hour) => {
        const count = Math.round(weight * weekendMult * size * rng.uniform(0.7, 1.3));
        for (let i = 0; i < count; i++) {
          db.insert("transactions", {
            store_id: store.id, timestamp: dayStart + hour * HOUR + rng.int(0, 59) * MINUTE,
            category: rng.choice(CATEGORIES), amount: pyRound(rng.uniform(15, 120), 2),
          });
        }
      });
    }
  }

  // ---- offers -------------------------------------------------------------------------
  db.insert("offers", { title: "20% off fresh berries", subtitle: "Ends tonight", tone: "green", category: "Produce", active: true, starts_at: at(-2), ends_at: null });
  db.insert("offers", { title: "Frozen bundle deal", subtitle: "Buy 2, save AED 12", tone: "blue", category: "Frozen", active: true, starts_at: at(-2), ends_at: null });
  db.insert("offers", { title: "Bakery: buy 1 get 1", subtitle: "Weekends only", tone: "amber", category: "Bakery", active: true, starts_at: at(-2), ends_at: null });

  // ---- Layla's list and history, so receipts and recommendations have real data ----------
  [["SKU-1101", true], ["SKU-1301", true], ["SKU-1103", false], ["SKU-1002", false], ["SKU-1102", false]].forEach(([sku, checked], i) => {
    db.insert("shopping_list_items", { customer_id: layla.id, product_id: bySku[sku].id, quantity: 1, checked, added_at: at(-1, 0, i) });
  });

  const placeOrder = ({ customer: who, cashier, store, method, lines, daysAgo, channel }) => {
    let total = 0;
    const items = lines.map(([sku, quantity]) => {
      total += bySku[sku].price * quantity;
      return { product_id: bySku[sku].id, quantity, unit_price: bySku[sku].price };
    });
    total = pyRound(total, 2);
    const points = who ? Math.trunc(total) : 0;
    if (who && channel === "cashier") who.loyalty_points += points;
    return db.insert("customer_orders", {
      customer_id: who?.id ?? null, store_id: store.id, total, loyalty_points_earned: points, points_redeemed: 0, channel,
      cashier_id: cashier?.id ?? null, payment_method: method ?? null, amount_tendered: channel === "cashier" ? total : null,
      change_due: channel === "cashier" ? 0 : null, created_at: at(-daysAgo, -rng.int(0, 5)), items,
    });
  };
  placeOrder({ customer: layla, cashier: null, store: hq, method: null, lines: [["SKU-1101", 2], ["SKU-1301", 1], ["SKU-1002", 1]], daysAgo: 6, channel: "self_checkout" });
  [
    [omar, marcus, hq, "card", [["SKU-1201", 1], ["SKU-1401", 2]], 9],
    [fatima, diego, hq, "cash", [["SKU-1301", 1], ["SKU-1102", 3]], 3],
    [fatima, aisha, hq, "apple_pay", [["SKU-1001", 2]], 1],
    [rahul, priya, riverside, "card", [["SKU-1402", 1], ["SKU-1103", 1]], 5],
    [null, priya, riverside, "cash", [["SKU-1003", 3], ["SKU-1303", 2]], 2],
    [null, aisha, northHills, "tabby", [["SKU-1201", 2], ["SKU-1202", 1]], 4],
  ].forEach(([who, cashier, store, method, lines, daysAgo]) =>
    placeOrder({ customer: who, cashier, store, method, lines, daysAgo, channel: "cashier" }));

  db.touch();
  return { stores, suppliers, products };
}
