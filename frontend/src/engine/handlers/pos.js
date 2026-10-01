// The staff-operated register: a loyalty customer directory plus cashier checkout that records the
// tender type. Nothing here touches a card network or wallet — selecting "Card" just records that the
// physical terminal settled the payment, like a till's tender column. The only real money-like state
// this software owns is loyalty points, an integer ledger on the customer.
import { PAYMENT_METHODS, POINTS_TO_AED } from "../constants.js";
import { orderStats } from "../helpers.js";
import * as out from "../serializers.js";
import { consumeStock, recordStockShortfall } from "../services.js";
import { HttpError, ilike, pyRound, respond } from "../util.js";
import { f, parseBody, parseQuery } from "../validate.js";

const QuickCustomerCreate = {
  name: f.str({ min: 1, max: 120 }),
  phone: f.str({ min: 3, max: 32 }),
  email: f.email({ optional: true, blankToNull: true, lower: true }),
};

const CashierCheckoutRequest = {
  store_id: f.str(),
  customer_id: f.str({ optional: true }),
  items: f.list({ type: "object", fields: { product_id: f.str(), quantity: f.int({ default: 1, ge: 1, le: 999 }) } }),
  payment_method: f.str(),
  amount_tendered: f.float({ optional: true, ge: 0, le: 10_000_000 }),
  points_to_redeem: f.int({ default: 0, ge: 0 }),
};

const customerDetail = (db, user) => {
  const orders = db
    .where("customer_orders", (o) => o.customer_id === user.id)
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, 20)
    .map((o) => out.order(db, o));
  return { ...out.customerRow(user, orderStats(db, [user.id])), orders };
};

export function register(r) {
  // Register-side lookup by name, phone or email; most recently active accounts first, capped at 50.
  r.get("/pos/customers", async (ctx) => {
    await ctx.requireEmployee();
    const { search } = parseQuery({ search: f.str({ optional: true }) }, ctx.query);
    const term = search?.trim();
    const customers = ctx.db.where("users", (u) => u.role === "customer" && (!term || ilike(u.name, term) || ilike(u.phone, term) || ilike(u.email, term)));
    const stats = orderStats(ctx.db, customers.map((u) => u.id));
    const activity = (u) => Math.max(u.created_at, stats.get(u.id)?.[1] ?? 0);
    return customers
      .sort((a, b) => activity(b) - activity(a))
      .slice(0, 50)
      .map((u) => out.customerRow(u, stats));
  });

  r.get("/pos/customers/:id", async (ctx) => {
    await ctx.requireEmployee();
    const user = ctx.db.get("users", ctx.params.id);
    if (!user || user.role !== "customer") throw new HttpError(404, "Customer not found");
    return customerDetail(ctx.db, user);
  });

  // Quick loyalty sign-up at the till. If the number is already on file, the existing account comes back.
  r.post("/pos/customers", async (ctx) => {
    await ctx.requireEmployee();
    const payload = parseBody(QuickCustomerCreate, ctx.body);
    const phone = payload.phone.trim();
    if (!phone) throw new HttpError(422, "Phone number is required");

    const existing = ctx.db.all("users").find((u) => u.phone === phone);
    if (existing) {
      if (existing.role !== "customer") throw new HttpError(409, "This number belongs to a staff account, not a customer");
      return respond(201, customerDetail(ctx.db, existing));
    }

    const email = payload.email || `cust${phone.replace(/[^0-9]/g, "")}@members.retailmind.app`;
    if (ctx.db.all("users").some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new HttpError(409, "An account with that email already exists");
    }
    const user = ctx.db.insert("users", {
      name: payload.name.trim() || "Guest", email, phone, hashed_password: null, role: "customer", department: null, title: null,
      access_level: null, responsibilities: [], store_id: null, loyalty_points: 0, preferred_store_id: null,
      notify_restock: true, notify_security: true, notify_orders: true, created_at: ctx.now,
    });
    return respond(201, customerDetail(ctx.db, user));
  });

  // The register sale: a fresh cart, optional loyalty account and points redemption, a tender type —
  // stock is drawn down exactly as in self-checkout, so shelf-fill and reorder-needed stay honest.
  r.post("/pos/checkout", async (ctx) => {
    const cashier = await ctx.requireEmployee();
    const payload = parseBody(CashierCheckoutRequest, ctx.body);
    const { db } = ctx;

    if (!PAYMENT_METHODS.includes(payload.payment_method)) throw new HttpError(422, `payment_method must be one of ${PAYMENT_METHODS.join(", ")}`);
    if (!payload.items.length) throw new HttpError(422, "Cart is empty");
    if (!db.get("stores", payload.store_id)) throw new HttpError(404, "Store not found");

    const lines = payload.items.map((line) => {
      const product = db.get("products", line.product_id);
      if (!product) throw new HttpError(404, `Product ${line.product_id} not found`);
      return [product, line.quantity];
    });

    let customer = null;
    if (payload.customer_id) {
      customer = db.get("users", payload.customer_id);
      if (!customer || customer.role !== "customer") throw new HttpError(404, "Customer not found");
    }

    const subtotal = lines.reduce((s, [p, q]) => s + p.price * q, 0);
    let points = Math.max(0, payload.points_to_redeem);
    if (points && !customer) throw new HttpError(422, "Attach a customer to redeem loyalty points");
    if (customer && points > (customer.loyalty_points ?? 0)) throw new HttpError(422, `${customer.name} only has ${customer.loyalty_points ?? 0} points available`);
    points = Math.min(points, Math.trunc(subtotal / POINTS_TO_AED));
    const discount = pyRound(points * POINTS_TO_AED, 2);
    const total = pyRound(Math.max(0, subtotal - discount), 2);

    let amountTendered = total;
    let changeDue = 0;
    if (payload.payment_method === "cash") {
      if (payload.amount_tendered == null || payload.amount_tendered < total) throw new HttpError(422, "Amount tendered is less than the total due");
      amountTendered = pyRound(payload.amount_tendered, 2);
      changeDue = pyRound(amountTendered - total, 2);
    }

    for (const [product, qty] of lines) {
      const taken = consumeStock(db, payload.store_id, product.id, qty);
      if (taken < qty) recordStockShortfall(db, payload.store_id, product.name, qty, taken, ctx.now);
    }

    const earned = customer ? Math.trunc(total) : 0;
    const order = db.insert("customer_orders", {
      customer_id: customer?.id ?? null, store_id: payload.store_id, total, loyalty_points_earned: earned, points_redeemed: points,
      channel: "cashier", cashier_id: cashier.id, payment_method: payload.payment_method, amount_tendered: amountTendered,
      change_due: changeDue, created_at: ctx.now, items: lines.map(([p, q]) => ({ product_id: p.id, quantity: q, unit_price: p.price })),
    });
    if (customer) customer.loyalty_points = (customer.loyalty_points ?? 0) - points + earned;
    return respond(201, out.order(db, order));
  });
}
