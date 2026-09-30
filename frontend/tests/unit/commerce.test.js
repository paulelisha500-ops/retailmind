import { beforeAll, describe, expect, it } from "vitest";
import { boot } from "./helpers.js";

let t, layla, cashier, admin;
beforeAll(async () => {
  t = await boot();
  layla = await t.as("customer");
  cashier = await t.as("staff");
  admin = await t.as("admin");
});

const hqStock = (sku) => t.db.all("batches").filter((b) => b.store_id === t.hq.id && b.product_id === t.bySku(sku).id && b.status === "active").reduce((s, b) => s + b.quantity, 0);

describe("catalogue & offers", () => {
  it("searches by name, category and barcode", async () => {
    expect((await t.call("GET", "/customer/products?search=MILK", { token: layla })).body.map((p) => p.name)).toEqual(["Whole Milk (2L)"]);
    expect((await t.call("GET", "/customer/products?category=Frozen", { token: layla })).body).toHaveLength(3);
    expect((await t.call("GET", "/customer/products?barcode=8901000001025", { token: layla })).body[0].name).toBe("Greek Yogurt (500g)");
    expect((await t.call("GET", "/customer/products?search=zzz", { token: layla })).body).toEqual([]);
  });

  it("shows active offers only", async () => {
    expect((await t.call("GET", "/customer/offers", { token: layla })).body).toHaveLength(3);
    t.db.all("offers")[0].active = false;
    t.db.all("offers")[1].ends_at = Date.now() - 1000;
    expect((await t.call("GET", "/customer/offers", { token: layla })).body.map((o) => o.title)).toEqual(["Bakery: buy 1 get 1"]);
    t.db.all("offers")[0].active = true;
    t.db.all("offers")[1].ends_at = null;
  });
});

describe("shopping list & self-checkout", () => {
  it("returns the list newest-first with product details", async () => {
    const res = await t.call("GET", "/customer/shopping-list", { token: layla });
    expect(res.body).toHaveLength(5);
    expect(res.body[0].product).toMatchObject({ name: expect.any(String), price: expect.any(Number) });
    expect(res.body.filter((i) => i.checked)).toHaveLength(2);
  });

  it("merges a repeat add into the open line and caps quantity", async () => {
    const eggs = t.bySku("SKU-1103");
    const first = await t.call("POST", "/customer/shopping-list", { token: layla, body: { product_id: eggs.id, quantity: 2 } });
    expect(first.status).toBe(201);
    expect(first.body.quantity).toBe(3); // the unchecked eggs line already held 1
    const capped = await t.call("POST", "/customer/shopping-list", { token: layla, body: { product_id: eggs.id, quantity: 999 } });
    expect(capped.body.quantity).toBe(999);
    expect((await t.call("GET", "/customer/shopping-list", { token: layla })).body).toHaveLength(5);
    expect((await t.call("POST", "/customer/shopping-list", { token: layla, body: { product_id: "ghost" } })).status).toBe(404);
    expect((await t.call("POST", "/customer/shopping-list", { token: layla, body: { product_id: eggs.id, quantity: 0 } })).status).toBe(422);
    await t.call("PATCH", `/customer/shopping-list/${first.body.id}`, { token: layla, body: { quantity: 1 } });
  });

  it("edits and removes only the customer's own lines", async () => {
    const list = (await t.call("GET", "/customer/shopping-list", { token: layla })).body;
    const item = list.find((i) => i.product.sku === "SKU-1002");
    const edited = await t.call("PATCH", `/customer/shopping-list/${item.id}`, { token: layla, body: { quantity: 4, checked: true } });
    expect(edited.body).toMatchObject({ quantity: 4, checked: true });
    expect((await t.call("PATCH", `/customer/shopping-list/${item.id}`, { token: layla, body: { quantity: 1000 } })).status).toBe(422);
    const other = t.db.all("shopping_list_items")[0];
    t.db.insert("shopping_list_items", { customer_id: "someone-else", product_id: other.product_id, quantity: 1, checked: false, added_at: Date.now() });
    const foreign = t.db.all("shopping_list_items").at(-1);
    expect((await t.call("PATCH", `/customer/shopping-list/${foreign.id}`, { token: layla, body: { checked: true } })).status).toBe(404);
    expect((await t.call("DELETE", `/customer/shopping-list/${foreign.id}`, { token: layla })).status).toBe(404);
    expect((await t.call("DELETE", `/customer/shopping-list/${item.id}`, { token: layla })).status).toBe(204);
    t.db.remove("shopping_list_items", foreign.id);
  });

  it("turns checked lines into an order, earns points and draws stock FEFO", async () => {
    const milk = t.bySku("SKU-1101"), bread = t.bySku("SKU-1301");
    const before = { milk: hqStock("SKU-1101"), bread: hqStock("SKU-1301"), points: t.db.all("users").find((u) => u.role === "customer").loyalty_points };
    const res = await t.call("POST", "/customer/checkout", { token: layla, body: { store_id: t.hq.id } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ channel: "self_checkout", total: milk.price + bread.price, loyalty_points_earned: Math.trunc(milk.price + bread.price), customer_name: "Layla Hassan" });
    expect(res.body.items).toHaveLength(2);
    expect(hqStock("SKU-1101")).toBe(before.milk - 1);
    expect(hqStock("SKU-1301")).toBe(before.bread - 1);
    const me = await t.call("GET", "/auth/me", { token: layla });
    expect(me.body.loyalty_points).toBe(before.points + res.body.loyalty_points_earned);
    // Checked lines are gone, unchecked ones stay.
    expect((await t.call("GET", "/customer/shopping-list", { token: layla })).body.every((i) => !i.checked)).toBe(true);
  });

  it("refuses an empty checkout and an unknown store", async () => {
    expect(await t.call("POST", "/customer/checkout", { token: layla, body: { store_id: t.hq.id } })).toMatchObject({ status: 400, body: { detail: expect.stringContaining("No checked items") } });
    const item = (await t.call("GET", "/customer/shopping-list", { token: layla })).body[0];
    await t.call("PATCH", `/customer/shopping-list/${item.id}`, { token: layla, body: { checked: true } });
    expect(await t.call("POST", "/customer/checkout", { token: layla, body: { store_id: "ghost" } })).toMatchObject({ status: 404, body: { detail: "Store not found" } });
  });

  it("records a stock-count task when a sale outruns recorded stock", async () => {
    const bananas = t.bySku("SKU-1003");
    for (const b of t.db.all("batches")) if (b.product_id === bananas.id && b.store_id === t.hq.id) b.quantity = 1;
    const list = await t.call("POST", "/customer/shopping-list", { token: layla, body: { product_id: bananas.id, quantity: 3 } });
    await t.call("PATCH", `/customer/shopping-list/${list.body.id}`, { token: layla, body: { checked: true } });
    const res = await t.call("POST", "/customer/checkout", { token: layla, body: { store_id: t.hq.id } });
    expect(res.status).toBe(201); // the sale still stands
    const task = t.db.all("tasks").find((x) => x.title === "Stock count: Ripe Bananas (kg)");
    expect(task).toMatchObject({ source: "Stock count", done: false, detail: expect.stringContaining("Sold") });
  });

  it("builds receipts and computed recommendations", async () => {
    const receipts = await t.call("GET", "/customer/receipts", { token: layla });
    expect(receipts.body.length).toBeGreaterThanOrEqual(3);
    const times = receipts.body.map((r) => Date.parse(r.created_at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    const recs = await t.call("GET", "/customer/recommendations", { token: layla });
    expect(recs.body.length).toBeLessThanOrEqual(6);
    expect(recs.body[0].reason).toMatch(/You've bought this \d+ times? before/);
    const ids = recs.body.map((r) => r.product.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(recs.body.some((r) => /Popular in/.test(r.reason))).toBe(true);
  });

  it("recommends popular items to a customer with no history", async () => {
    const enrolled = await t.call("POST", "/pos/customers", { token: cashier, body: { name: "New Shopper", phone: "+971-55-300-3001", email: "new.shopper@retailmind.app" } });
    expect(enrolled.status).toBe(201);
    // Enrolled members have no app login, so exercise the function for a fresh account created the same way.
    const { hashPassword } = await import("../../src/engine/crypto.js");
    const user = t.db.get("users", enrolled.body.id);
    user.hashed_password = await hashPassword("pw-123456");
    const token = (await t.call("POST", "/auth/login", { body: { email: "new.shopper@retailmind.app", password: "pw-123456" } })).body.access_token;
    const recs = await t.call("GET", "/customer/recommendations", { token });
    expect(recs.body.length).toBeGreaterThan(0);
    expect(recs.body.every((r) => r.reason === "Popular with other customers")).toBe(true);
  });
});

describe("register: customer directory", () => {
  it("searches by name, phone or email and lists recent activity first", async () => {
    const all = await t.call("GET", "/pos/customers", { token: cashier });
    expect(all.body.length).toBeGreaterThanOrEqual(5);
    expect(all.body[0]).toMatchObject({ total_orders: expect.any(Number), loyalty_points: expect.any(Number), member_since: expect.stringMatching(/Z$/) });
    expect((await t.call("GET", "/pos/customers?search=fatima", { token: cashier })).body.map((c) => c.name)).toEqual(["Fatima Al Zaabi"]);
    expect((await t.call("GET", "/pos/customers?search=2004", { token: cashier })).body.map((c) => c.name)).toEqual(["Rahul Menon"]);
    expect((await t.call("GET", "/pos/customers?search=omar.al", { token: cashier })).body).toHaveLength(1);
    expect((await t.call("GET", "/pos/customers?search=nobody", { token: cashier })).body).toEqual([]);
  });

  it("opens a customer with their order history", async () => {
    const fatima = t.db.all("users").find((u) => u.name === "Fatima Al Zaabi");
    const res = await t.call("GET", `/pos/customers/${fatima.id}`, { token: cashier });
    expect(res.body).toMatchObject({ name: "Fatima Al Zaabi", total_orders: 2 });
    expect(res.body.orders).toHaveLength(2);
    expect(res.body.orders[0]).toMatchObject({ channel: "cashier", cashier_name: expect.any(String), items: expect.any(Array) });
    expect((await t.call("GET", "/pos/customers/ghost", { token: cashier })).status).toBe(404);
    const marcus = t.db.all("users").find((u) => u.email === "marcus@retailmind.app");
    expect((await t.call("GET", `/pos/customers/${marcus.id}`, { token: cashier })).status).toBe(404);
  });

  it("enrols at the till and returns the existing member for a known number", async () => {
    const created = await t.call("POST", "/pos/customers", { token: cashier, body: { name: "  Walk In  ", phone: " +971-55-400-4001 ", email: "" } });
    expect(created).toMatchObject({ status: 201, body: { name: "Walk In", phone: "+971-55-400-4001", loyalty_points: 0, total_orders: 0, orders: [] } });
    expect(created.body.email).toBe("cust971554004001@members.retailmind.app");
    const again = await t.call("POST", "/pos/customers", { token: cashier, body: { name: "Someone Else", phone: "+971-55-400-4001" } });
    expect(again.body.id).toBe(created.body.id);
    expect(again.body.name).toBe("Walk In");
    expect(await t.call("POST", "/pos/customers", { token: cashier, body: { name: "Imposter", phone: "+971-50-100-1001" } })).toMatchObject({ status: 409, body: { detail: "This number belongs to a staff account, not a customer" } });
    expect(await t.call("POST", "/pos/customers", { token: cashier, body: { name: "Dup", phone: "+971-55-400-4999", email: "layla@members.retailmind.app" } })).toMatchObject({ status: 409 });
    expect((await t.call("POST", "/pos/customers", { token: cashier, body: { name: "", phone: "+971-1" } })).status).toBe(422);
    expect((await t.call("POST", "/pos/customers", { token: cashier, body: { name: "Ok", phone: "12" } })).status).toBe(422);
  });
});

describe("register: cashier checkout", () => {
  const sale = (over = {}) => ({ store_id: t.hq.id, items: [{ product_id: t.bySku("SKU-1001").id, quantity: 2 }], payment_method: "card", ...over });

  it("rings up a walk-in card sale and draws stock down", async () => {
    const before = hqStock("SKU-1001");
    const res = await t.call("POST", "/pos/checkout", { token: cashier, body: sale() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ total: 17.8, channel: "cashier", payment_method: "card", customer_name: "Guest", loyalty_points_earned: 0, change_due: 0, cashier_name: "Diego Ramirez" });
    expect(hqStock("SKU-1001")).toBe(before - 2);
  });

  it("handles cash with change, and refuses short tender", async () => {
    const short = await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ payment_method: "cash", amount_tendered: 10 }) });
    expect(short).toMatchObject({ status: 422, body: { detail: "Amount tendered is less than the total due" } });
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ payment_method: "cash" }) })).status).toBe(422);
    const ok = await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ payment_method: "cash", amount_tendered: 20 }) });
    expect(ok.body).toMatchObject({ total: 17.8, amount_tendered: 20, change_due: 2.2 });
  });

  it("awards and redeems loyalty points on the member's account", async () => {
    const omar = t.db.all("users").find((u) => u.name === "Omar Al Suwaidi");
    const start = omar.loyalty_points;
    const res = await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ customer_id: omar.id, points_to_redeem: 500, payment_method: "apple_pay" }) });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ points_redeemed: 500, total: 12.8, customer_name: "Omar Al Suwaidi", loyalty_points_earned: 12 }); // 17.80 − AED 5.00
    expect(omar.loyalty_points).toBe(start - 500 + 12);
  });

  it("caps redemption at the basket value and validates the rules", async () => {
    const fatima = t.db.all("users").find((u) => u.name === "Fatima Al Zaabi");
    const capped = await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ customer_id: fatima.id, points_to_redeem: 2000, payment_method: "tabby" }) });
    expect(capped.body).toMatchObject({ points_redeemed: 1780, total: 0 });
    expect(await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ points_to_redeem: 100 }) })).toMatchObject({ status: 422, body: { detail: "Attach a customer to redeem loyalty points" } });
    const rahul = t.db.all("users").find((u) => u.name === "Rahul Menon");
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ customer_id: rahul.id, points_to_redeem: 99999 }) })).body.detail).toBe(`Rahul Menon only has ${rahul.loyalty_points} points available`);
  });

  it("validates the cart", async () => {
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ payment_method: "bitcoin" }) })).body.detail).toBe("payment_method must be one of cash, card, apple_pay, google_pay, samsung_pay, tabby");
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ items: [] }) })).body.detail).toBe("Cart is empty");
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ store_id: "ghost" }) })).body.detail).toBe("Store not found");
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ items: [{ product_id: "ghost", quantity: 1 }] }) })).body.detail).toBe("Product ghost not found");
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ customer_id: "ghost" }) })).body.detail).toBe("Customer not found");
    expect((await t.call("POST", "/pos/checkout", { token: cashier, body: sale({ items: [{ product_id: t.bySku("SKU-1001").id, quantity: 0 }] }) })).status).toBe(422);
    expect((await t.call("POST", "/pos/checkout", { token: layla, body: sale() })).status).toBe(403);
  });

  it("feeds the sale into analytics the same way", async () => {
    const movers = await t.call("GET", `/analytics/movers?store_id=${t.hq.id}`, { token: cashier });
    expect(movers.body.length).toBeGreaterThan(0);
    const apples = movers.body.find((m) => m.product_name === "Gala Apples (kg)");
    expect(apples.units_sold_recent).toBeGreaterThanOrEqual(8); // the four sales above, two kilos each
    expect(apples.days_of_supply).toBeGreaterThan(0);
    expect(movers.body.map((m) => m.units_sold_recent)).toEqual([...movers.body.map((m) => m.units_sold_recent)].sort((a, b) => b - a));
  });
});
