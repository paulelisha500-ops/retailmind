// Warehouse: storage utilisation, a replenishment pick route and floor-traffic planning, all
// computed live from stock, alerts and checkout timestamps.
import { DAY, dayKey, pyRound, pyWeekday } from "../util.js";
import { f, parseQuery } from "../validate.js";

const storeParam = (ctx) => parseQuery({ store_id: f.str() }, ctx.query).store_id;

const aisleSortKey = (location) => {
  if (!location) return [999, ""];
  const m = /\d+/.exec(location);
  return [m ? parseInt(m[0], 10) : 999, location];
};
const compareAisle = (a, b) => {
  const [na, sa] = aisleSortKey(a.location);
  const [nb, sb] = aisleSortKey(b.location);
  return na - nb || (sa < sb ? -1 : sa > sb ? 1 : 0);
};

export function register(r) {
  r.get("/warehouse/zones", async (ctx) => {
    await ctx.requireEmployee();
    const storeId = storeParam(ctx);
    const { db } = ctx;
    return db
      .where("warehouse_zones", (z) => z.store_id === storeId)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((zone) => {
        let current;
        if (zone.categories.length) {
          current = db
            .where("batches", (b) => b.store_id === storeId && b.status === "active" && zone.categories.includes(db.get("products", b.product_id)?.category))
            .reduce((s, b) => s + b.quantity, 0);
        } else {
          // Receiving/staging has no category of its own: expected inbound units (draft + approved POs) are the real proxy.
          current = db
            .where("purchase_orders", (p) => p.store_id === storeId && ["draft", "approved"].includes(p.status))
            .flatMap((p) => p.items)
            .reduce((s, i) => s + i.quantity, 0);
        }
        return {
          id: zone.id, name: zone.name, current_units: current, capacity_units: zone.capacity_units,
          pct: zone.capacity_units ? pyRound(Math.min(100, (current / zone.capacity_units) * 100), 1) : 0,
        };
      });
  });

  // Every open stock/quality alert plus every batch expiring within 3 days, ordered by aisle number.
  r.get("/warehouse/pick-route", async (ctx) => {
    await ctx.requireEmployee();
    const storeId = storeParam(ctx);
    const { db } = ctx;
    const steps = [];
    const openAlerts = db.where("alerts", (a) => a.store_id === storeId && a.status !== "resolved" && a.kind !== "theft");
    for (const a of openAlerts) steps.push({ location: a.location, task: a.message, source: "Shelf/quality alert" });

    const covered = new Set(openAlerts.map((a) => a.location));
    const cutoff = ctx.now + 3 * DAY;
    for (const b of db.where("batches", (x) => x.store_id === storeId && x.status === "active" && x.expires_at <= cutoff)) {
      const location = b.aisle_location || "Unassigned";
      if (covered.has(location)) continue; // an alert at the same spot already covers it
      const daysLeft = Math.max(0, Math.floor((b.expires_at - ctx.now) / DAY));
      const product = db.get("products", b.product_id);
      steps.push({ location, task: `Rotate/markdown ${product.name} — ${daysLeft}d left (${b.lot_number})`, source: "FEFO expiry" });
    }
    return steps.sort(compareAisle).map((s, i) => ({ step: i + 1, location: s.location, task: s.task, source: s.source }));
  });

  // Average transactions per hour of day, normalised 0-100 against this store's own busiest hour.
  r.get("/warehouse/congestion", async (ctx) => {
    await ctx.requireEmployee();
    const storeId = storeParam(ctx);
    const perHour = new Map();
    for (const t of ctx.db.where("transactions", (x) => x.store_id === storeId)) {
      const hour = new Date(t.timestamp).getUTCHours();
      const entry = perHour.get(hour) ?? { count: 0, days: new Set() };
      entry.count += 1;
      entry.days.add(dayKey(t.timestamp));
      perHour.set(hour, entry);
    }
    if (!perHour.size) return [];
    const averages = new Map([...perHour.entries()].map(([hour, v]) => [hour, v.days.size ? v.count / v.days.size : 0]));
    const peak = Math.max(...averages.values()) || 1;
    return [...averages.keys()].sort((a, b) => a - b).map((hour) => ({
      hour: `${hour % 12 || 12}${hour < 12 ? "a" : "p"}`,
      level: pyRound((averages.get(hour) / peak) * 100, 1),
      transaction_count: pyRound(averages.get(hour), 0),
    }));
  });

  // Saturday volume against the weekday average over the same window, scaled from a baseline crew.
  r.get("/warehouse/staffing", async (ctx) => {
    await ctx.requireEmployee();
    const storeId = storeParam(ctx);
    const baseline = 4;
    const rows = ctx.db.where("transactions", (x) => x.store_id === storeId);
    const plan = (recommended, reason) => ({ day: "Saturday", recommended_staff: recommended, baseline_staff: baseline, reason });
    if (!rows.length) return plan(baseline, "No transaction history yet — showing the baseline crew size.");

    const perDay = new Map();
    for (const t of rows) perDay.set(dayKey(t.timestamp), (perDay.get(dayKey(t.timestamp)) ?? 0) + 1);
    const saturdays = [];
    const others = [];
    for (const [key, count] of perDay) (pyWeekday(Date.parse(key)) === 5 ? saturdays : others).push(count);
    if (!saturdays.length || !others.length) return plan(baseline, "Not enough same-week history yet to compare Saturday to weekdays.");

    const satAvg = saturdays.reduce((a, b) => a + b, 0) / saturdays.length;
    const weekdayAvg = others.reduce((a, b) => a + b, 0) / others.length;
    const ratio = weekdayAvg ? satAvg / weekdayAvg : 1;
    const pct = Math.round((ratio - 1) * 100);
    return plan(
      Math.max(baseline, pyRound(baseline * ratio, 0)),
      `Saturday averages ${Math.round(satAvg)} transactions/day vs ${Math.round(weekdayAvg)} on weekdays (${pct >= 0 ? "+" : ""}${pct}%) over the recorded history — scaled from a baseline crew of ${baseline}.`,
    );
  });
}
