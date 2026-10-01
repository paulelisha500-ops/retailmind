// Stores, tasks, alerts and the notification feed.
import { byName, mustFind, stockByProduct } from "../helpers.js";
import * as out from "../serializers.js";
import { HOUR, iso } from "../util.js";
import { f, parseQuery } from "../validate.js";

export function register(r) {
  // ---- stores ---------------------------------------------------------------------------
  // Any signed-in user can read the store list (staff Enterprise picker; customers need it to check out).
  r.get("/stores", async (ctx) => {
    await ctx.currentUser();
    return [...ctx.db.all("stores")].sort(byName).map(out.store);
  });

  // ---- tasks ----------------------------------------------------------------------------
  r.get("/tasks", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id } = parseQuery({ store_id: f.str() }, ctx.query);
    return ctx.db
      .where("tasks", (t) => t.store_id === store_id)
      .sort((a, b) => Number(a.done) - Number(b.done) || b.created_at - a.created_at)
      .map(out.task);
  });

  r.patch("/tasks/:id/toggle", async (ctx) => {
    await ctx.requireEmployee();
    const task = mustFind(ctx.db, "tasks", ctx.params.id, "Task not found");
    task.done = !task.done;
    return out.task(task);
  });

  // ---- alerts (the vision pipeline's review queue) ---------------------------------------
  r.get("/alerts", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id, status } = parseQuery({ store_id: f.str(), status: f.str({ optional: true }) }, ctx.query);
    return ctx.db
      .where("alerts", (a) => a.store_id === store_id && (!status || a.status === status))
      .sort((a, b) => b.created_at - a.created_at)
      .map(out.alert);
  });

  // "Mark reviewed": the alert closes because a person looked at it, not because the flag was proven right.
  r.patch("/alerts/:id/resolve", async (ctx) => {
    await ctx.requireEmployee();
    const alert = mustFind(ctx.db, "alerts", ctx.params.id, "Alert not found");
    alert.status = "resolved";
    alert.resolved_at = ctx.now;
    return out.alert(alert);
  });

  // ---- notifications: open alerts, low stock and recent payments, filtered by the user's own preferences ----
  r.get("/notifications", async (ctx) => {
    const user = await ctx.requireEmployee();
    const { store_id } = parseQuery({ store_id: f.str() }, ctx.query);
    const { db } = ctx;
    const items = [];
    const openAlerts = db.where("alerts", (a) => a.store_id === store_id && a.status !== "resolved");

    if (user.notify_security) {
      for (const a of openAlerts.filter((x) => x.kind === "theft")) {
        items.push({ id: `alert-${a.id}`, kind: "alert", severity: a.severity, title: `Loss prevention alert · ${a.location}`, detail: a.message, created_at: a.created_at });
      }
    }

    if (user.notify_restock) {
      for (const a of openAlerts.filter((x) => x.kind !== "theft")) {
        const label = a.kind === "quality" ? "Quality" : "Stock";
        items.push({ id: `alert-${a.id}`, kind: "alert", severity: a.severity, title: `${label} alert · ${a.location}`, detail: a.message, created_at: a.created_at });
      }
      const stock = stockByProduct(db, store_id);
      for (const p of db.all("products")) {
        const current = stock.get(p.id) ?? 0;
        if (current < p.reorder_threshold) {
          items.push({
            id: `restock-${p.id}`, kind: "restock", severity: current === 0 ? "red" : "amber",
            title: `${current === 0 ? "Out of stock" : "Low stock"} · ${p.name}`,
            detail: `${current} of ${p.reorder_threshold} (reorder point) on hand`, created_at: ctx.now,
          });
        }
      }
    }

    if (user.notify_orders) {
      const since = ctx.now - 48 * HOUR;
      for (const o of db.where("customer_orders", (x) => x.store_id === store_id && x.created_at >= since)) {
        items.push({ id: `order-${o.id}`, kind: "order", severity: "green", title: "Payment received", detail: `AED ${o.total.toFixed(2)} · ${o.loyalty_points_earned} loyalty points issued`, created_at: o.created_at });
      }
    }

    return items.sort((a, b) => b.created_at - a.created_at).slice(0, 30).map((n) => ({ ...n, created_at: iso(n.created_at) }));
  });
}
