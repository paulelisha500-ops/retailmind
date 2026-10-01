import { ONBOARDING_STATUSES } from "../constants.js";
import { mustFind, stockByProduct } from "../helpers.js";
import * as out from "../serializers.js";
import { placeCall, sendEmail } from "../services.js";
import { HttpError, parseCsv, respond } from "../util.js";
import { f, parseBody, parseQuery, providedKeys } from "../validate.js";
import { pyFloat } from "./inventory.js";

const SUPPLIER_NULLABLE_FIELDS = new Set(["contact_email", "contact_phone", "trade_license_no", "trn", "payment_terms", "cold_chain", "contract_end"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The supplier form sends "" for an untouched optional email — that means "unset", not "invalid".
const SupplierCreate = {
  name: f.str({ min: 1, max: 200 }),
  category: f.str({ min: 1, max: 80 }),
  contact_email: f.email({ optional: true, blankToNull: true }),
  contact_phone: f.str({ optional: true }),
  trade_license_no: f.str({ optional: true }),
  trn: f.str({ optional: true }),
  payment_terms: f.str({ optional: true }),
  cold_chain: f.str({ optional: true }),
  onboarding_status: f.enumOf(ONBOARDING_STATUSES, { default: "pending" }),
  performance_score: f.int({ default: 80, ge: 0, le: 100 }),
  on_time_pct: f.float({ default: 90, ge: 0, le: 100 }),
  late_deliveries_30d: f.int({ default: 0, ge: 0, le: 10_000 }),
  contract_end: f.datetime({ optional: true }),
};

const SupplierUpdate = {
  name: f.str({ optional: true, min: 1, max: 200 }),
  category: f.str({ optional: true, min: 1, max: 80 }),
  contact_email: f.email({ optional: true, blankToNull: true }),
  contact_phone: f.str({ optional: true }),
  trade_license_no: f.str({ optional: true }),
  trn: f.str({ optional: true }),
  payment_terms: f.str({ optional: true }),
  cold_chain: f.str({ optional: true }),
  onboarding_status: f.enumOf(ONBOARDING_STATUSES, { optional: true }),
  performance_score: f.int({ optional: true, ge: 0, le: 100 }),
  on_time_pct: f.float({ optional: true, ge: 0, le: 100 }),
  late_deliveries_30d: f.int({ optional: true, ge: 0, le: 10_000 }),
  contract_end: f.datetime({ optional: true }),
};

const ContactRequest = {
  store_id: f.str(),
  channel: f.str(),
  product_id: f.str({ optional: true }),
  note: f.str({ optional: true }),
};

const Decision = { decided_by: f.str() };

export function register(r) {
  r.get("/procurement/suppliers", async (ctx) => {
    await ctx.requireEmployee();
    return [...ctx.db.all("suppliers")].sort((a, b) => b.performance_score - a.performance_score).map(out.supplier);
  });

  r.post("/procurement/suppliers", async (ctx) => {
    await ctx.requireResponsibility("Supplier Management");
    const payload = parseBody(SupplierCreate, ctx.body);
    const supplier = ctx.db.insert("suppliers", { ...payload, contract_start: null, created_at: ctx.now });
    return respond(201, out.supplier(supplier));
  });

  // Vendor-onboarding intake sheet: licence and TRN alongside the usual commercial fields. A column that is in the
  // file sets that field; a column that is not in the file leaves existing suppliers alone.
  r.post("/procurement/suppliers/import", async (ctx) => {
    await ctx.requireResponsibility("Supplier Management");
    if (!ctx.file) throw new HttpError(422, [{ loc: ["body", "file"], msg: "Field required", type: "missing" }]);
    if (!ctx.file.name.toLowerCase().endsWith(".csv")) throw new HttpError(422, "Please upload a .csv file");
    const { fieldnames, records } = parseCsv(ctx.file.text);
    if (!fieldnames) throw new HttpError(422, "Empty file");
    const present = new Set(fieldnames.map((h) => (h ?? "").trim().toLowerCase()));
    const missing = ["name", "category"].filter((c) => !present.has(c)).sort();
    if (missing.length) throw new HttpError(422, `CSV is missing required column(s): ${missing.join(", ")}`);

    const existingByName = new Map(ctx.db.all("suppliers").map((s) => [s.name.trim().toLowerCase(), s]));
    let created = 0;
    let updated = 0;
    const errors = [];

    records.forEach((rawRow, index) => {
      const i = index + 2;
      const row = Object.fromEntries(Object.entries(rawRow).map(([k, v]) => [(k ?? "").trim().toLowerCase(), (v ?? "").trim()]));
      const name = row.name;
      if (!name) { errors.push(`Row ${i}: missing name, skipped`); return; }

      const int = (key, fallback) => (/^-?\d+$/.test(row[key] ?? "") ? parseInt(row[key], 10) : fallback);
      const float = (key, fallback) => {
        if (!row[key]) return fallback;
        const n = pyFloat(row[key]);
        return Number.isNaN(n) ? fallback : n;
      };
      const fields = {
        category: row.category || "Produce", contact_email: row.contact_email || null, contact_phone: row.contact_phone || null,
        trade_license_no: row.trade_license_no || null, trn: row.trn || null, payment_terms: row.payment_terms || null,
        cold_chain: row.cold_chain || null, onboarding_status: row.onboarding_status || "pending",
        performance_score: int("performance_score", 80), on_time_pct: float("on_time_pct", 90),
        late_deliveries_30d: int("late_deliveries_30d", 0),
      };

      let problem = null;
      if (fields.contact_email && !EMAIL_RE.test(fields.contact_email)) problem = "contact_email is not a valid email";
      else if (!ONBOARDING_STATUSES.includes(fields.onboarding_status)) problem = "onboarding_status must be pending, compliance_review, approved or suspended";
      else if (!(fields.performance_score >= 0 && fields.performance_score <= 100)) problem = "performance_score must be 0-100";
      else if (!(Number.isFinite(fields.on_time_pct) && fields.on_time_pct >= 0 && fields.on_time_pct <= 100)) problem = "on_time_pct must be 0-100";
      else if (fields.late_deliveries_30d < 0) problem = "late_deliveries_30d can't be negative";
      if (problem) { errors.push(`Row ${i}: ${problem}, skipped`); return; }

      const existing = existingByName.get(name.toLowerCase());
      if (existing) {
        Object.assign(existing, Object.fromEntries(Object.entries(fields).filter(([key]) => key === "category" || present.has(key))));
        updated += 1;
      } else {
        const supplier = ctx.db.insert("suppliers", { name, ...fields, contract_start: null, contract_end: null, created_at: ctx.now });
        existingByName.set(name.toLowerCase(), supplier);
        created += 1;
      }
    });

    return { created, updated, errors };
  });

  r.patch("/procurement/suppliers/:id", async (ctx) => {
    await ctx.requireResponsibility("Supplier Management");
    const changes = parseBody(SupplierUpdate, ctx.body);
    const supplier = mustFind(ctx.db, "suppliers", ctx.params.id, "Supplier not found");
    for (const field of providedKeys(changes)) {
      const value = changes[field];
      if (value === null && !SUPPLIER_NULLABLE_FIELDS.has(field)) continue;
      supplier[field] = value;
    }
    return out.supplier(supplier);
  });

  r.delete("/procurement/suppliers/:id", async (ctx) => {
    await ctx.requireResponsibility("Supplier Management");
    const supplier = mustFind(ctx.db, "suppliers", ctx.params.id, "Supplier not found");
    const { db } = ctx;
    const inUse =
      db.all("products").some((p) => p.supplier_id === supplier.id) ||
      db.all("purchase_orders").some((p) => p.supplier_id === supplier.id) ||
      db.all("supplier_contact_log").some((c) => c.supplier_id === supplier.id);
    if (inUse) {
      throw new HttpError(409, "Can't delete — this supplier has products or purchase orders referencing it. Reassign or remove those first.");
    }
    db.remove("suppliers", supplier.id);
    return respond(204);
  });

  // Real detection: every product whose active stock here has fallen below its own reorder point.
  r.get("/procurement/reorder-needed", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id } = parseQuery({ store_id: f.str() }, ctx.query);
    const stock = stockByProduct(ctx.db, store_id);
    const rows = [];
    for (const p of ctx.db.all("products")) {
      const current = stock.get(p.id) ?? 0;
      if (current >= p.reorder_threshold) continue;
      const supplier = p.supplier_id ? ctx.db.get("suppliers", p.supplier_id) : null;
      rows.push({
        product_id: p.id, product_name: p.name, category: p.category, supplier_id: supplier?.id ?? null,
        supplier_name: supplier?.name ?? null, current_stock: current, reorder_threshold: p.reorder_threshold,
      });
    }
    return rows;
  });

  // Manager-triggered, per click. Always logged; dispatched only if a provider is connected.
  r.post("/procurement/suppliers/:id/notify", async (ctx) => {
    const user = await ctx.requireResponsibility("Supplier Management");
    const payload = parseBody(ContactRequest, ctx.body);
    if (!["email", "call"].includes(payload.channel)) throw new HttpError(422, "channel must be 'email' or 'call'");
    const supplier = mustFind(ctx.db, "suppliers", ctx.params.id, "Supplier not found");

    const product = payload.product_id ? ctx.db.get("products", payload.product_id) : null;
    const reason = product
      ? `${product.name} is low on stock (below its reorder threshold of ${product.reorder_threshold}).`
      : payload.note || "Manual outreach requested.";
    const message =
      `Hi ${supplier.name}, this is ${user.name} from RetailMind. ${reason} Could you confirm availability and lead time for a reorder?` +
      (payload.note && product ? ` Note: ${payload.note}` : "");

    const [status, detail] = payload.channel === "email" ? sendEmail() : placeCall();
    const log = ctx.db.insert("supplier_contact_log", {
      supplier_id: supplier.id, store_id: payload.store_id, product_id: product?.id ?? null, triggered_by: user.id,
      channel: payload.channel, reason: `${reason} [${detail}]`, message, status, created_at: ctx.now,
    });
    return respond(201, out.contactLog(log));
  });

  r.get("/procurement/contact-log", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id } = parseQuery({ store_id: f.str() }, ctx.query);
    return ctx.db
      .where("supplier_contact_log", (c) => c.store_id === store_id)
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 50)
      .map(out.contactLog);
  });

  r.get("/procurement/orders", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id, status } = parseQuery({ store_id: f.str(), status: f.str({ optional: true }) }, ctx.query);
    return ctx.db
      .where("purchase_orders", (p) => p.store_id === store_id && (!status || p.status === status))
      .sort((a, b) => b.created_at - a.created_at)
      .map(out.purchaseOrder);
  });

  const decide = (next) => async (ctx) => {
    const user = await ctx.requireResponsibility("Purchase Approvals");
    parseBody(Decision, ctx.body);
    const order = mustFind(ctx.db, "purchase_orders", ctx.params.id, "Purchase order not found");
    if (order.status !== "draft") throw new HttpError(409, `Order is already ${order.status}`);
    order.status = next;
    order.approved_by = user.id;
    order.approved_at = ctx.now;
    return out.purchaseOrder(order);
  };
  r.patch("/procurement/orders/:id/approve", decide("approved"));
  r.patch("/procurement/orders/:id/reject", decide("rejected"));
}

