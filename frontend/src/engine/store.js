// In-memory relational store for the browser edition. Every table is a plain array plus an
// id index; the whole thing is snapshotted to IndexedDB (see persist.js) after writes.
import { DAY, startOfUtcDay, uuid } from "./util.js";

export const SCHEMA_VERSION = 1;

export const TABLES = [
  "stores", "users", "suppliers", "products", "batches", "purchase_orders", "alerts", "tasks",
  "sales_records", "warehouse_zones", "transactions", "shopping_list_items", "offers",
  "customer_orders", "supplier_contact_log",
];

/** Columns holding timestamps that move with the workspace clock (see alignClock). */
const TIME_FIELDS = {
  stores: ["created_at"],
  users: ["created_at"],
  suppliers: ["contract_start", "contract_end", "created_at"],
  products: ["created_at"],
  batches: ["received_at", "expires_at"],
  purchase_orders: ["created_at", "need_by", "approved_at"],
  alerts: ["created_at", "resolved_at"],
  tasks: ["created_at"],
  sales_records: ["date"],
  transactions: ["timestamp"],
  shopping_list_items: ["added_at"],
  offers: ["starts_at", "ends_at"],
  customer_orders: ["created_at"],
  supplier_contact_log: ["created_at"],
};

export const emptyState = () => ({
  version: SCHEMA_VERSION,
  meta: { revision: 0, seededAt: null, clockDay: null, jwtSecret: null },
  tables: Object.fromEntries(TABLES.map((t) => [t, []])),
});

export class Database {
  constructor(state = emptyState()) {
    this.listeners = new Set();
    this.load(state);
  }

  load(state) {
    this.meta = state.meta;
    this.tables = state.tables;
    for (const t of TABLES) this.tables[t] ??= [];
    this.index = {};
    for (const t of TABLES) this.index[t] = new Map(this.tables[t].map((r) => [r.id, r]));
  }

  get(table, id) {
    return id == null ? null : this.index[table].get(id) ?? null;
  }

  all(table) {
    return this.tables[table];
  }

  where(table, predicate) {
    return this.tables[table].filter(predicate);
  }

  insert(table, row) {
    row.id ??= uuid();
    this.tables[table].push(row);
    this.index[table].set(row.id, row);
    return row;
  }

  remove(table, id) {
    const rows = this.tables[table];
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return false;
    rows.splice(i, 1);
    this.index[table].delete(id);
    return true;
  }

  /** Marks the workspace changed; persistence listens for this. */
  touch() {
    this.meta.revision += 1;
    for (const fn of this.listeners) fn(this);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot() {
    return { version: SCHEMA_VERSION, meta: this.meta, tables: this.tables };
  }
}

/**
 * The workspace clock: data only "ages" while the app is in use. When the app is reopened
 * N whole days later, every timestamp moves forward by N days, so "last 7 days", expiry
 * countdowns and order history stay meaningful instead of draining away. Returns N.
 */
export function alignClock(db, now = Date.now()) {
  const today = startOfUtcDay(now);
  if (db.meta.clockDay == null) {
    db.meta.clockDay = today;
    return 0;
  }
  const shiftDays = Math.floor((today - db.meta.clockDay) / DAY);
  if (shiftDays <= 0) return 0;
  const delta = shiftDays * DAY;
  for (const [table, fields] of Object.entries(TIME_FIELDS)) {
    for (const row of db.all(table)) {
      for (const field of fields) if (row[field] != null) row[field] += delta;
    }
  }
  db.meta.clockDay = today;
  db.touch();
  return shiftDays;
}
