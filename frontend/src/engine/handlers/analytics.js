import { POINTS_TO_AED } from "../constants.js";
import { stockByProduct } from "../helpers.js";
import { DAY, monthDay, pyRound, startOfUtcDay, sum, weekdayShort } from "../util.js";
import { f, parseQuery } from "../validate.js";

const thousands = (n) => Math.round(n).toLocaleString("en-US");

export function register(r) {
  // Admin-only: revenue and margin aren't shown to associates. No store_id = the enterprise rollup.
  r.get("/analytics/summary", async (ctx) => {
    await ctx.requireAdmin();
    const { store_id } = parseQuery({ store_id: f.str({ optional: true }) }, ctx.query);
    const { db } = ctx;
    const since = startOfUtcDay(ctx.now) - 7 * DAY; // the last seven full days

    const records = db.where("sales_records", (s) => s.date >= since && (!store_id || s.store_id === store_id));
    const totalRevenue = sum(records, (x) => x.revenue);
    const totalUnits = sum(records, (x) => x.units_sold);
    const promoUnits = sum(records.filter((x) => x.promo_flag), (x) => x.units_sold);

    const byDay = new Map();
    const byCategory = new Map();
    for (const x of records) {
      byDay.set(x.date, (byDay.get(x.date) ?? 0) + x.revenue);
      byCategory.set(x.category, (byCategory.get(x.category) ?? 0) + x.revenue);
    }
    const salesTrend = [...byDay.entries()].sort(([a], [b]) => a - b).map(([date, revenue]) => ({ day: weekdayShort(date), revenue: pyRound(revenue, 2) }));
    const categoryRevenueMix = [...byCategory.entries()].map(([name, value]) => ({ name, value: totalRevenue ? pyRound((value / totalRevenue) * 100, 1) : 0 }));

    // Waste: real % of received units written off, per category. null ("no data") is never shown as 0% waste.
    const wasteByCategory = [...byCategory.keys()].map((name) => {
      const lots = db.where("batches", (b) => (!store_id || b.store_id === store_id) && db.get("products", b.product_id)?.category === name);
      const total = sum(lots, (b) => b.quantity);
      const removed = sum(lots.filter((b) => b.status === "removed"), (b) => b.quantity);
      return { name, pct: total ? pyRound((removed / total) * 100, 1) : null };
    });

    const storeComparison = store_id
      ? []
      : db.all("stores").map((s) => ({
          name: s.name, code: s.code,
          revenue: pyRound(sum(db.where("sales_records", (x) => x.store_id === s.id && x.date >= since), (x) => x.revenue), 2),
        }));

    const promoShare = totalUnits ? (promoUnits / totalUnits) * 100 : 0;
    return {
      kpis: [
        { label: "Revenue (7d)", value: `AED ${thousands(totalRevenue)}`, delta: "see trend below", good: true },
        { label: "Units sold (7d)", value: thousands(totalUnits), delta: `${byCategory.size} categories`, good: true },
        { label: "Avg daily revenue", value: `AED ${thousands(totalRevenue / 7)}`, delta: "7-day window", good: true },
        { label: "Promo-driven units", value: thousands(promoUnits), delta: `${Math.round(promoShare)}% of units`, good: true },
      ],
      sales_trend: salesTrend,
      category_revenue_mix: categoryRevenueMix,
      waste_by_category: wasteByCategory,
      store_comparison: storeComparison,
    };
  });

  // What's selling out fast: real per-product velocity from checkout line items, with days of supply.
  r.get("/analytics/movers", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id, days, limit } = parseQuery({ store_id: f.str(), days: f.int({ default: 14, ge: 1 }), limit: f.int({ default: 10, ge: 1 }) }, ctx.query);
    const since = ctx.now - days * DAY;
    const sold = new Map();
    for (const o of ctx.db.where("customer_orders", (x) => x.store_id === store_id && x.created_at >= since)) {
      for (const it of o.items) sold.set(it.product_id, (sold.get(it.product_id) ?? 0) + it.quantity);
    }
    const stock = stockByProduct(ctx.db, store_id);
    return [...sold.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .flatMap(([productId, qty]) => {
        const product = ctx.db.get("products", productId);
        if (!product) return [];
        const dailyRate = qty / days;
        return [{
          product_id: product.id, product_name: product.name, category: product.category, units_sold_recent: qty,
          days_of_supply: dailyRate > 0 ? pyRound((stock.get(productId) ?? 0) / dailyRate, 1) : null,
        }];
      });
  });

  // Trading P&L at the level a hypermarket store manager reviews: gross sales, loyalty discounts,
  // net sales, COGS at landed cost, gross profit. Rent and payroll aren't modelled, so it stops at gross margin.
  r.get("/analytics/pnl", async (ctx) => {
    await ctx.requireAdmin();
    const { store_id, days } = parseQuery({ store_id: f.str({ optional: true }), days: f.int({ default: 30, ge: 1 }) }, ctx.query);
    const { db } = ctx;
    const since = startOfUtcDay(ctx.now) - days * DAY;

    const orders = db.where("customer_orders", (o) => o.created_at >= since && (!store_id || o.store_id === store_id));
    const items = orders.flatMap((o) => o.items.map((it) => ({ ...it, order: o })));
    const costOf = (it) => it.quantity * (db.get("products", it.product_id)?.cost_price ?? 0);

    const grossSales = sum(items, (it) => it.unit_price * it.quantity);
    const discounts = sum(orders, (o) => (o.points_redeemed ?? 0) * POINTS_TO_AED);
    const netSales = pyRound(grossSales - discounts, 2);
    const missingCost = new Set(items.filter((it) => db.get("products", it.product_id)?.cost_price == null).map((it) => it.product_id));
    const cogs = pyRound(sum(items, costOf), 2);
    const grossProfit = pyRound(netSales - cogs, 2);

    const procurementSpend = pyRound(
      sum(db.where("purchase_orders", (p) => p.created_at >= since && ["approved", "delivered"].includes(p.status) && (!store_id || p.store_id === store_id)), (p) => p.total_cost),
      2,
    );

    // A batch fully sold through checkout also ends up "removed" but with its quantity drained to 0,
    // so only a removed batch that STILL has quantity on it is real waste.
    const shrunk = db.where("batches", (b) => b.status === "removed" && b.quantity > 0 && (!store_id || b.store_id === store_id));
    const shrinkageCost = pyRound(sum(shrunk, (b) => b.quantity * (db.get("products", b.product_id)?.cost_price ?? 0)), 2);

    // Points on customer accounts are a redeemable balance, carried as a liability (not store-scoped).
    const loyaltyLiability = pyRound(sum(db.where("users", (u) => u.role === "customer"), (u) => u.loyalty_points ?? 0) * POINTS_TO_AED, 2);

    const margin = (revenue, cost) => (revenue ? pyRound(((revenue - cost) / revenue) * 100, 1) : 0);

    const catTotals = new Map();
    for (const it of items) {
      const cat = db.get("products", it.product_id)?.category ?? "Uncategorized";
      const entry = catTotals.get(cat) ?? { revenue: 0, cogs: 0 };
      entry.revenue += it.unit_price * it.quantity;
      entry.cogs += costOf(it);
      catTotals.set(cat, entry);
    }
    const byCategory = [...catTotals.entries()].sort(([, a], [, b]) => b.revenue - a.revenue).map(([category, v]) => ({
      category, revenue: pyRound(v.revenue, 2), cogs: pyRound(v.cogs, 2), gross_profit: pyRound(v.revenue - v.cogs, 2), margin_pct: margin(v.revenue, v.cogs),
    }));

    // Every store appears in the enterprise view, including ones with no sales: a silent 0 is a real answer.
    const byStore = store_id
      ? []
      : db.all("stores").map((s) => {
          const mine = items.filter((it) => it.order.store_id === s.id);
          return { s, revenue: sum(mine, (it) => it.unit_price * it.quantity), cost: sum(mine, costOf) };
        }).sort((a, b) => b.revenue - a.revenue).map(({ s, revenue, cost }) => ({
          store_id: s.id, store_name: s.name, store_code: s.code, revenue: pyRound(revenue, 2), cogs: pyRound(cost, 2),
          gross_profit: pyRound(revenue - cost, 2), margin_pct: margin(revenue, cost),
        }));

    const trendTotals = new Map();
    for (const o of orders) {
      const day = startOfUtcDay(o.created_at);
      const entry = trendTotals.get(day) ?? { revenue: 0, cogs: 0 };
      entry.revenue += o.total;
      for (const it of o.items) entry.cogs += costOf(it);
      trendTotals.set(day, entry);
    }
    const trend = [...trendTotals.entries()].sort(([a], [b]) => a - b).map(([day, v]) => ({
      label: monthDay(day), revenue: pyRound(v.revenue, 2), cogs: pyRound(v.cogs, 2), gross_profit: pyRound(v.revenue - v.cogs, 2),
    }));

    return {
      period_days: days, orders: orders.length, gross_sales: pyRound(grossSales, 2), discounts: pyRound(discounts, 2),
      net_sales: netSales, cogs, gross_profit: grossProfit, margin_pct: netSales ? pyRound((grossProfit / netSales) * 100, 1) : 0,
      avg_order_value: orders.length ? pyRound(netSales / orders.length, 2) : 0,
      procurement_spend: procurementSpend, shrinkage_units: sum(shrunk, (b) => b.quantity), shrinkage_cost: shrinkageCost,
      loyalty_liability: loyaltyLiability, products_missing_cost: missingCost.size,
      by_category: byCategory, by_store: byStore, trend,
    };
  });
}
