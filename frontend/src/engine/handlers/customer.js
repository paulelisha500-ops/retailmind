// Customer app: catalogue search, shopping list, self-checkout with loyalty points, receipts, offers
// and recommendations computed from real order history.
import { byName, mustFind } from "../helpers.js";
import * as out from "../serializers.js";
import { consumeStock, recordStockShortfall } from "../services.js";
import { HttpError, ilike, respond, pyRound } from "../util.js";
import { f, parseBody, parseQuery, providedKeys } from "../validate.js";

const ShoppingListItemCreate = { product_id: f.str(), quantity: f.int({ default: 1, ge: 1, le: 999 }) };
const ShoppingListItemUpdate = { quantity: f.int({ optional: true, ge: 1, le: 999 }), checked: f.bool({ optional: true }) };
const CheckoutRequest = { store_id: f.str() };

const quantitiesBy = (rows) => {
  const totals = new Map();
  for (const { key, qty } of rows) totals.set(key, (totals.get(key) ?? 0) + qty);
  return [...totals.entries()].sort(([, a], [, b]) => b - a);
};

export function register(r) {
  r.get("/customer/products", async (ctx) => {
    await ctx.requireCustomer();
    const { category, search, barcode } = parseQuery({ category: f.str({ optional: true }), search: f.str({ optional: true }), barcode: f.str({ optional: true }) }, ctx.query);
    return ctx.db
      .where("products", (p) => (!category || p.category === category) && (!barcode || p.barcode === barcode) && (!search || ilike(p.name, search)))
      .sort(byName)
      .map(out.product);
  });

  r.get("/customer/shopping-list", async (ctx) => {
    const user = await ctx.requireCustomer();
    return ctx.db
      .where("shopping_list_items", (i) => i.customer_id === user.id)
      .sort((a, b) => b.added_at - a.added_at)
      .map((i) => out.shoppingItem(ctx.db, i));
  });

  r.post("/customer/shopping-list", async (ctx) => {
    const user = await ctx.requireCustomer();
    const payload = parseBody(ShoppingListItemCreate, ctx.body);
    mustFind(ctx.db, "products", payload.product_id, "Product not found");
    const existing = ctx.db.where("shopping_list_items", (i) => i.customer_id === user.id && i.product_id === payload.product_id && !i.checked)[0];
    if (existing) {
      existing.quantity = Math.min(999, existing.quantity + payload.quantity);
      return respond(201, out.shoppingItem(ctx.db, existing));
    }
    const item = ctx.db.insert("shopping_list_items", { customer_id: user.id, product_id: payload.product_id, quantity: payload.quantity, checked: false, added_at: ctx.now });
    return respond(201, out.shoppingItem(ctx.db, item));
  });

  const ownItem = (ctx, user) => {
    const item = ctx.db.get("shopping_list_items", ctx.params.id);
    if (!item || item.customer_id !== user.id) throw new HttpError(404, "Item not found");
    return item;
  };

  r.patch("/customer/shopping-list/:id", async (ctx) => {
    const user = await ctx.requireCustomer();
    const changes = parseBody(ShoppingListItemUpdate, ctx.body);
    const item = ownItem(ctx, user);
    const provided = providedKeys(changes);
    if (provided.has("quantity") && changes.quantity !== null) item.quantity = changes.quantity;
    if (provided.has("checked") && changes.checked !== null) item.checked = changes.checked;
    return out.shoppingItem(ctx.db, item);
  });

  r.delete("/customer/shopping-list/:id", async (ctx) => {
    const user = await ctx.requireCustomer();
    ctx.db.remove("shopping_list_items", ownItem(ctx, user).id);
    return respond(204);
  });

  // Checked list items become a real order at live prices: 1 loyalty point per AED spent, stock drawn FEFO.
  r.post("/customer/checkout", async (ctx) => {
    const user = await ctx.requireCustomer();
    const payload = parseBody(CheckoutRequest, ctx.body);
    const { db } = ctx;
    const items = db.where("shopping_list_items", (i) => i.customer_id === user.id && i.checked);
    if (!items.length) throw new HttpError(400, "No checked items to check out — check off items on your list first");
    if (items.some((i) => i.quantity <= 0)) throw new HttpError(422, "Item quantity must be at least 1");
    if (!db.get("stores", payload.store_id)) throw new HttpError(404, "Store not found");

    let total = 0;
    const lines = [];
    for (const item of items) {
      const product = db.get("products", item.product_id);
      if (!product) continue;
      total += product.price * item.quantity;
      lines.push({ product_id: product.id, quantity: item.quantity, unit_price: product.price });
      const taken = consumeStock(db, payload.store_id, product.id, item.quantity);
      if (taken < item.quantity) recordStockShortfall(db, payload.store_id, product.name, item.quantity, taken, ctx.now);
    }

    const points = Math.trunc(total);
    const order = db.insert("customer_orders", {
      customer_id: user.id, store_id: payload.store_id, total: pyRound(total, 2), loyalty_points_earned: points, points_redeemed: 0,
      channel: "self_checkout", cashier_id: null, payment_method: null, amount_tendered: null, change_due: null, created_at: ctx.now, items: lines,
    });
    user.loyalty_points = (user.loyalty_points ?? 0) + points;
    for (const item of items) db.remove("shopping_list_items", item.id);
    return respond(201, out.order(db, order));
  });

  r.get("/customer/receipts", async (ctx) => {
    const user = await ctx.requireCustomer();
    return ctx.db
      .where("customer_orders", (o) => o.customer_id === user.id)
      .sort((a, b) => b.created_at - a.created_at)
      .map((o) => out.order(ctx.db, o));
  });

  r.get("/customer/offers", async (ctx) => {
    await ctx.requireCustomer();
    return ctx.db.where("offers", (o) => o.active && (o.ends_at == null || o.ends_at >= ctx.now)).map(out.offer);
  });

  // Computed from this customer's own order history (frequent items + their top categories), falling
  // back to store-wide popularity and then a plain catalogue sample for a brand-new account.
  r.get("/customer/recommendations", async (ctx) => {
    const user = await ctx.requireCustomer();
    const { db } = ctx;
    const mine = db.where("customer_orders", (o) => o.customer_id === user.id).flatMap((o) => o.items);
    const frequent = quantitiesBy(mine.map((i) => ({ key: i.product_id, qty: i.quantity }))).slice(0, 3);

    const recs = [];
    const seen = new Set();
    for (const [productId, qty] of frequent) {
      const product = db.get("products", productId);
      if (product) {
        recs.push({ product: out.product(product), reason: `You've bought this ${qty} time${qty !== 1 ? "s" : ""} before` });
        seen.add(product.id);
      }
    }

    if (frequent.length) {
      const topCategories = quantitiesBy(mine.map((i) => ({ key: db.get("products", i.product_id)?.category, qty: i.quantity })).filter((x) => x.key))
        .slice(0, 2).map(([category]) => category);
      for (const product of db.where("products", (p) => topCategories.includes(p.category) && !seen.has(p.id)).slice(0, 4)) {
        recs.push({ product: out.product(product), reason: `Popular in ${product.category}, which you shop often` });
        seen.add(product.id);
      }
    } else {
      const everyone = db.all("customer_orders").flatMap((o) => o.items);
      for (const [productId] of quantitiesBy(everyone.map((i) => ({ key: i.product_id, qty: i.quantity }))).slice(0, 5)) {
        const product = db.get("products", productId);
        if (product) recs.push({ product: out.product(product), reason: "Popular with other customers" });
      }
      if (!recs.length) for (const product of db.all("products").slice(0, 5)) recs.push({ product: out.product(product), reason: "New to the store — worth a try" });
    }
    return recs.slice(0, 6);
  });
}
