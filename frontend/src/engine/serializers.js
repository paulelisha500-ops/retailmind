// Row → response shapes. Field names and types match the REST contract the UI is built against;
// timestamps leave the engine as UTC ISO-8601 strings (with the trailing Z).
import { iso } from "./util.js";

export const userMe = (u) => ({
  id: u.id, name: u.name, email: u.email, role: u.role, department: u.department, title: u.title,
  access_level: u.access_level, responsibilities: u.responsibilities ?? [], store_id: u.store_id,
  loyalty_points: u.loyalty_points ?? 0, preferred_store_id: u.preferred_store_id,
  notify_restock: u.notify_restock, notify_security: u.notify_security, notify_orders: u.notify_orders,
});

export const teamMember = (u) => ({
  id: u.id, name: u.name, email: u.email, department: u.department, title: u.title,
  access_level: u.access_level, responsibilities: u.responsibilities ?? [], store_id: u.store_id,
});

export const store = (s) => ({ id: s.id, name: s.name, code: s.code, region: s.region, is_headquarters: !!s.is_headquarters });

export const batch = (b) => ({
  id: b.id, product_id: b.product_id, store_id: b.store_id, lot_number: b.lot_number, quantity: b.quantity,
  aisle_location: b.aisle_location, received_at: iso(b.received_at), expires_at: iso(b.expires_at), status: b.status,
});

export const product = (p) => ({
  id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, category: p.category, unit: p.unit, price: p.price,
  cost_price: p.cost_price, reorder_threshold: p.reorder_threshold, nutrition: p.nutrition ?? {},
  allergens: p.allergens ?? [], dietary_tags: p.dietary_tags ?? [], supplier_id: p.supplier_id,
});

export const supplier = (s) => ({
  id: s.id, name: s.name, category: s.category, contact_email: s.contact_email, contact_phone: s.contact_phone,
  trade_license_no: s.trade_license_no, trn: s.trn, payment_terms: s.payment_terms, cold_chain: s.cold_chain,
  onboarding_status: s.onboarding_status ?? "pending", performance_score: s.performance_score,
  on_time_pct: s.on_time_pct, late_deliveries_30d: s.late_deliveries_30d, contract_end: iso(s.contract_end),
});

export const purchaseOrder = (p) => ({
  id: p.id, po_number: p.po_number, supplier_id: p.supplier_id, store_id: p.store_id, status: p.status,
  total_cost: p.total_cost, need_by: iso(p.need_by), created_from: p.created_from,
  forecast_confidence: p.forecast_confidence, items: (p.items ?? []).map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_cost: i.unit_cost })),
});

export const alert = (a) => ({
  id: a.id, store_id: a.store_id, kind: a.kind, severity: a.severity, model_source: a.model_source,
  location: a.location, message: a.message, confidence: a.confidence, status: a.status,
  assigned_to: a.assigned_to, created_at: iso(a.created_at),
});

export const task = (t) => ({
  id: t.id, store_id: t.store_id, assigned_to: t.assigned_to, title: t.title, detail: t.detail, source: t.source, done: !!t.done,
});

export const offer = (o) => ({ id: o.id, title: o.title, subtitle: o.subtitle, tone: o.tone, category: o.category });

export const contactLog = (c) => ({
  id: c.id, supplier_id: c.supplier_id, product_id: c.product_id, channel: c.channel, reason: c.reason,
  message: c.message, status: c.status, created_at: iso(c.created_at),
});

export const shoppingItem = (db, i) => ({
  id: i.id, product_id: i.product_id, quantity: i.quantity, checked: !!i.checked, product: product(db.get("products", i.product_id)),
});

export const order = (db, o) => {
  const customer = db.get("users", o.customer_id);
  const cashier = db.get("users", o.cashier_id);
  return {
    id: o.id, store_id: o.store_id, customer_id: o.customer_id, customer_name: customer ? customer.name : "Guest",
    total: o.total, loyalty_points_earned: o.loyalty_points_earned, points_redeemed: o.points_redeemed ?? 0,
    channel: o.channel, cashier_id: o.cashier_id, cashier_name: cashier ? cashier.name : null,
    payment_method: o.payment_method, amount_tendered: o.amount_tendered, change_due: o.change_due, created_at: iso(o.created_at),
    items: (o.items ?? []).map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, product: product(db.get("products", i.product_id)) })),
  };
};

export const customerRow = (u, stats) => {
  const [count, last] = stats.get(u.id) ?? [0, null];
  return {
    id: u.id, name: u.name, phone: u.phone, email: u.email, loyalty_points: u.loyalty_points ?? 0,
    member_since: iso(u.created_at), total_orders: count, last_order_at: iso(last),
  };
};
