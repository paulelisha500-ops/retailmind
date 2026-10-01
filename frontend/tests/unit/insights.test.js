import { beforeAll, describe, expect, it } from "vitest";
import { DAY } from "../../src/engine/util.js";
import { alignClock } from "../../src/engine/store.js";
import { boot } from "./helpers.js";

let t, admin, staff;
beforeAll(async () => {
  t = await boot();
  admin = await t.as("admin");
  staff = await t.as("staff");
});

describe("analytics summary", () => {
  it("rolls up seven full days with formatted KPIs", async () => {
    const res = await t.call("GET", "/analytics/summary", { token: admin });
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.kpis.map((k) => k.label)).toEqual(["Revenue (7d)", "Units sold (7d)", "Avg daily revenue", "Promo-driven units"]);
    expect(body.kpis[0].value).toMatch(/^AED [\d,]+$/);
    expect(body.sales_trend).toHaveLength(7);
    expect(body.category_revenue_mix).toHaveLength(5);
    expect(body.category_revenue_mix.reduce((s, c) => s + c.value, 0)).toBeGreaterThan(99);
    expect(body.category_revenue_mix.reduce((s, c) => s + c.value, 0)).toBeLessThan(101);
    expect(body.store_comparison.map((s) => s.name).sort()).toEqual(["Airport Plaza", "Downtown Central", "North Hills", "Riverside Mall"]);
    // The flagship outsells the smaller formats.
    const revenue = Object.fromEntries(body.store_comparison.map((s) => [s.name, s.revenue]));
    expect(revenue["Downtown Central"]).toBeGreaterThan(revenue["Riverside Mall"]);
    expect(revenue["Riverside Mall"]).toBeGreaterThan(revenue["North Hills"]);
  });

  it("scopes to one store and drops the cross-store comparison", async () => {
    const all = (await t.call("GET", "/analytics/summary", { token: admin })).body;
    const hq = (await t.call("GET", `/analytics/summary?store_id=${t.hq.id}`, { token: admin })).body;
    expect(hq.store_comparison).toEqual([]);
    const total = (x) => Number(x.kpis[0].value.replace(/\D/g, ""));
    expect(total(hq)).toBeLessThan(total(all));
    const hqRevenue = all.store_comparison.find((s) => s.name === "Downtown Central").revenue;
    expect(Math.abs(total(hq) - hqRevenue)).toBeLessThan(1);
  });

  it("reports waste per category, with no-data as null rather than zero", async () => {
    const body = (await t.call("GET", `/analytics/summary?store_id=${t.hq.id}`, { token: admin })).body;
    const bakery = body.waste_by_category.find((w) => w.name === "Bakery");
    expect(bakery.pct).toBeGreaterThan(0); // the written-off croissant lot
    expect(body.waste_by_category.find((w) => w.name === "Produce").pct).toBe(0);
    for (const b of [...t.db.all("batches")]) if (b.store_id === t.hq.id && t.db.get("products", b.product_id).category === "Frozen") t.db.remove("batches", b.id);
    const after = (await t.call("GET", `/analytics/summary?store_id=${t.hq.id}`, { token: admin })).body;
    expect(after.waste_by_category.find((w) => w.name === "Frozen").pct).toBeNull();
  });
});

describe("profit & loss", () => {
  it("adds up: net = gross − discounts, profit = net − COGS", async () => {
    const pnl = (await t.call("GET", "/analytics/pnl?days=30", { token: admin })).body;
    expect(pnl.period_days).toBe(30);
    expect(pnl.orders).toBe(7);
    expect(pnl.net_sales).toBeCloseTo(pnl.gross_sales - pnl.discounts, 2);
    expect(pnl.gross_profit).toBeCloseTo(pnl.net_sales - pnl.cogs, 2);
    expect(pnl.margin_pct).toBeCloseTo((pnl.gross_profit / pnl.net_sales) * 100, 0);
    expect(pnl.avg_order_value).toBeCloseTo(pnl.net_sales / pnl.orders, 1);
    expect(pnl.by_category.reduce((s, c) => s + c.revenue, 0)).toBeCloseTo(pnl.gross_sales, 1);
    expect(pnl.by_store).toHaveLength(4);
    expect(pnl.by_store.map((s) => s.revenue)).toEqual([...pnl.by_store.map((s) => s.revenue)].sort((a, b) => b - a));
    expect(pnl.trend.map((x) => x.label)[0]).toMatch(/^[A-Z][a-z]{2} \d{2}$/);
    expect(pnl.products_missing_cost).toBe(0);
    expect(pnl.shrinkage_units).toBe(18); // the written-off croissant lot
    expect(pnl.loyalty_liability).toBeGreaterThan(0);
  });

  it("scopes to a store, windows by days, and flags products with no cost", async () => {
    const hq = (await t.call("GET", `/analytics/pnl?store_id=${t.hq.id}&days=30`, { token: admin })).body;
    expect(hq.by_store).toEqual([]);
    expect(hq.orders).toBeLessThan(7);
    const narrow = (await t.call("GET", "/analytics/pnl?days=2", { token: admin })).body;
    expect(narrow.orders).toBeLessThan(7);
    t.bySku("SKU-1201").cost_price = null;
    const missing = (await t.call("GET", "/analytics/pnl?days=30", { token: admin })).body;
    expect(missing.products_missing_cost).toBeGreaterThan(0);
    expect((await t.call("GET", "/analytics/pnl?days=0", { token: admin })).status).toBe(422);
  });
});

describe("warehouse", () => {
  it("computes zone utilisation from stock, and staging from inbound orders", async () => {
    const zones = (await t.call("GET", `/warehouse/zones?store_id=${t.hq.id}`, { token: staff })).body;
    expect(zones.map((z) => z.name)).toEqual(["Zone A · Dry Goods & Produce", "Zone B · Cold Storage", "Zone C · Frozen", "Zone D · Receiving & Staging"]);
    const frozen = zones[2];
    const onHand = t.db.all("batches").filter((b) => b.store_id === t.hq.id && b.status === "active" && t.db.get("products", b.product_id).category === "Frozen").reduce((s, b) => s + b.quantity, 0);
    expect(frozen.current_units).toBe(onHand);
    const capacity = t.db.all("warehouse_zones").find((z) => z.store_id === t.hq.id && z.name.includes("Frozen")).capacity_units;
    expect(frozen.capacity_units).toBe(capacity);
    expect(frozen.pct).toBeCloseTo(Math.min(100, (onHand / capacity) * 100), 1);
    expect(zones[3].current_units).toBe(340); // PO-1042 is inbound
  });

  it("orders the pick route by aisle and skips expiries an alert already covers", async () => {
    const batch = t.db.all("batches").find((b) => b.store_id === t.hq.id && b.status === "active" && b.aisle_location.startsWith("Aisle 14"));
    batch.expires_at = Date.now() + DAY;
    const route = (await t.call("GET", `/warehouse/pick-route?store_id=${t.hq.id}`, { token: staff })).body;
    expect(route.map((r) => r.step)).toEqual(route.map((_, i) => i + 1));
    const aisles = route.map((r) => parseInt(/\d+/.exec(r.location)[0], 10));
    expect(aisles).toEqual([...aisles].sort((a, b) => a - b));
    expect(route.find((r) => r.source === "FEFO expiry").task).toMatch(/^Rotate\/markdown .+ — \d+d left \(LOT-\d+\)$/);
    expect(route.some((r) => r.source === "Shelf/quality alert")).toBe(true);
    expect(route.every((r) => !r.task.includes("Concealment"))).toBe(true); // theft alerts aren't a stocking task
  });

  it("normalises floor traffic against the store's own busiest hour", async () => {
    const curve = (await t.call("GET", `/warehouse/congestion?store_id=${t.hq.id}`, { token: staff })).body;
    expect(Math.max(...curve.map((c) => c.level))).toBe(100);
    const labels = curve.map((c) => c.hour);
    expect(labels[0]).toBe("6a");
    expect(labels).toContain("12p");
    expect(labels.at(-1)).toBe("10p");
    const noon = curve.find((c) => c.hour === "12p");
    expect(noon.transaction_count).toBeGreaterThan(5);
  });

  it("scales Saturday staffing from the real weekday ratio", async () => {
    const plan = (await t.call("GET", `/warehouse/staffing?store_id=${t.hq.id}`, { token: staff })).body;
    expect(plan).toMatchObject({ day: "Saturday", baseline_staff: 4 });
    expect(plan.recommended_staff).toBeGreaterThanOrEqual(4);
    expect(plan.reason).toMatch(/Saturday averages \d+ transactions\/day vs \d+ on weekdays \(\+\d+%\)/);
    const empty = t.byName("stores", "Riverside Mall");
    for (const tx of t.db.all("transactions").filter((x) => x.store_id === empty.id)) t.db.remove("transactions", tx.id);
    expect((await t.call("GET", `/warehouse/staffing?store_id=${empty.id}`, { token: staff })).body.reason).toMatch(/No transaction history/);
    expect((await t.call("GET", `/warehouse/congestion?store_id=${empty.id}`, { token: staff })).body).toEqual([]);
  });
});

describe("assistant", () => {
  const ask = (question) => t.call("POST", "/assistant/ask", { token: staff, body: { question, store_id: t.hq.id } });

  it("routes each question to the right agent", async () => {
    expect((await ask("Which products need attention this week?")).body.agent).toBe("Quality Agent");
    expect((await ask("Which supplier performs best?")).body.agent).toBe("Procurement Agent");
    expect((await ask("Is dairy demand actually decreasing?")).body.agent).toBe("Forecast Agent");
    expect((await ask("Any security concerns today?")).body.agent).toBe("Loss Prevention Agent");
    expect((await ask("What should I restock first?")).body.agent).toBe("Inventory Agent");
    expect((await ask("hello there")).body).toMatchObject({ agent: "RetailMind Assistant", tone: "neutral" });
  });

  it("answers from real data", async () => {
    const supplier = (await ask("best supplier")).body;
    expect(supplier.text).toContain("Polar Cold Logistics leads at a 96 score");
    expect(supplier.text).toContain("Golden Wheat Bakers is the weak link");
    const security = (await ask("any theft?")).body;
    expect(security).toMatchObject({ tone: "red" });
    expect(security.text).toContain("Checkout Zone · Lane 3");
    const demand = (await ask("How is bakery demand?")).body;
    expect(demand.text).toMatch(/^Bakery is trending (up|down) about \d+% this week vs last week/);
    expect((await ask("dairy sales")).body.text).toContain("Dairy & Chilled");
    expect((await ask("overall demand")).body.text).toMatch(/^Overall demand/);
  });

  it("reflects changes in the underlying data", async () => {
    for (const a of t.db.all("alerts")) a.status = "resolved";
    expect((await ask("security")).body).toMatchObject({ tone: "green", text: "No open security flags right now." });
    expect((await ask("expiring quality")).body.agent).toBe("Quality Agent");
    expect((await t.call("POST", "/assistant/ask", { token: staff, body: { question: "x" } })).status).toBe(422);
    expect((await t.call("POST", "/assistant/ask", { token: await t.as("customer"), body: { question: "x", store_id: "y" } })).status).toBe(403);
  });
});

describe("workspace clock", () => {
  it("moves every timestamp forward by the whole days the app was closed", async () => {
    const w = await boot();
    const sample = () => ({
      sale: w.db.all("sales_records").at(-1).date,
      batch: w.db.all("batches")[0].expires_at,
      order: w.db.all("customer_orders")[0].created_at,
      contract: w.db.all("suppliers")[0].contract_end,
    });
    const before = sample();
    w.time.offset += 3 * DAY + 60_000; // the app is reopened three days later
    expect(alignClock(w.db, w.engine.clock())).toBe(3);
    const after = sample();
    for (const key of Object.keys(before)) expect(after[key] - before[key]).toBe(3 * DAY);
    expect(alignClock(w.db, w.engine.clock())).toBe(0); // idempotent within the same day
    // Stock that expired "yesterday" stays fresh relative to the clock: nothing drains away.
    const summary = await w.call("GET", "/analytics/summary", { token: await w.as("admin") });
    expect(summary.body.sales_trend).toHaveLength(7);
  });
});
