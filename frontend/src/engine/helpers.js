// Small queries used by several routes.
import { HttpError, pyRound } from "./util.js";

/** Active on-hand units per product at one store. */
export function stockByProduct(db, storeId) {
  const stock = new Map();
  for (const b of db.all("batches")) {
    if (b.store_id === storeId && b.status === "active") stock.set(b.product_id, (stock.get(b.product_id) ?? 0) + b.quantity);
  }
  return stock;
}

export function mustFind(db, table, id, detail) {
  const row = db.get(table, id);
  if (!row) throw new HttpError(404, detail);
  return row;
}

export const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
export const descBy = (key) => (a, b) => b[key] - a[key];
export const money = (n) => pyRound(n, 2);

/** Loyalty/order stats per customer: id → [orderCount, lastOrderAt]. */
export function orderStats(db, customerIds) {
  const wanted = new Set(customerIds);
  const stats = new Map();
  for (const o of db.all("customer_orders")) {
    if (!wanted.has(o.customer_id)) continue;
    const [count, last] = stats.get(o.customer_id) ?? [0, null];
    stats.set(o.customer_id, [count + 1, last == null || o.created_at > last ? o.created_at : last]);
  }
  return stats;
}
