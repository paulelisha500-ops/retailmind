import { beforeAll, describe, expect, it } from "vitest";
import { csvFile, boot } from "./helpers.js";

let t, admin, manager, procurement;
beforeAll(async () => {
  t = await boot();
  admin = await t.as("admin");
  manager = await t.as("manager"); // Inventory Monitoring
  procurement = await t.as("staff"); // Supplier Management
});

const product = (over = {}) => ({ sku: "SKU-9001", name: "Olive Oil (1L)", category: "Pantry", price: 29.5, cost_price: 21, reorder_threshold: 20, ...over });

describe("products", () => {
  it("lists alphabetically and filters by category", async () => {
    const res = await t.call("GET", "/inventory/products", { token: manager });
    expect(res.body).toHaveLength(15);
    expect(res.body.map((p) => p.name)).toEqual([...res.body.map((p) => p.name)].sort());
    const bakery = await t.call("GET", "/inventory/products?category=Bakery", { token: manager });
    expect(bakery.body).toHaveLength(3);
    expect(bakery.body[0]).toMatchObject({ nutrition: expect.any(Object), allergens: expect.any(Array), dietary_tags: expect.any(Array) });
  });

  it("creates, rejects duplicates and validates", async () => {
    const created = await t.call("POST", "/inventory/products", { token: manager, body: product() });
    expect(created).toMatchObject({ status: 201, body: { sku: "SKU-9001", unit: "each", allergens: [], nutrition: {}, supplier_id: null } });
    expect(await t.call("POST", "/inventory/products", { token: manager, body: product() })).toMatchObject({ status: 409, body: { detail: "SKU SKU-9001 already exists" } });

    const bad = await t.call("POST", "/inventory/products", { token: manager, body: product({ sku: "SKU-9002", price: 0 }) });
    expect(bad.status).toBe(422);
    expect(bad.body.detail[0]).toMatchObject({ loc: ["body", "price"], msg: "Input should be greater than 0" });
    expect((await t.call("POST", "/inventory/products", { token: manager, body: product({ sku: "SKU-9003", price: 2_000_000 }) })).status).toBe(422);
    expect((await t.call("POST", "/inventory/products", { token: manager, body: product({ sku: "SKU-9004", supplier_id: "ghost" }) })).status).toBe(404);
    expect((await t.call("POST", "/inventory/products", { token: manager, body: product({ sku: "SKU-9005", barcode: "8901000000011" }) })).status).toBe(409);
  });

  it("updates only what was sent, and lets cost and supplier be cleared", async () => {
    const id = t.db.all("products").find((p) => p.sku === "SKU-9001").id;
    const supplier = t.db.all("suppliers")[0];
    const renamed = await t.call("PATCH", `/inventory/products/${id}`, { token: manager, body: { name: "Extra Virgin Olive Oil", supplier_id: supplier.id } });
    expect(renamed.body).toMatchObject({ name: "Extra Virgin Olive Oil", price: 29.5, cost_price: 21, supplier_id: supplier.id });
    const cleared = await t.call("PATCH", `/inventory/products/${id}`, { token: manager, body: { cost_price: null, supplier_id: null, name: null } });
    expect(cleared.body).toMatchObject({ cost_price: null, supplier_id: null, name: "Extra Virgin Olive Oil" }); // null name is ignored
    expect((await t.call("PATCH", `/inventory/products/${id}`, { token: manager, body: { price: -1 } })).status).toBe(422);
    expect((await t.call("PATCH", "/inventory/products/nope", { token: manager, body: { name: "x" } })).status).toBe(404);
  });

  it("refuses to delete a product that stock or orders reference, and deletes a clean one", async () => {
    const milk = t.bySku("SKU-1101");
    expect(await t.call("DELETE", `/inventory/products/${milk.id}`, { token: manager })).toMatchObject({ status: 409, body: { detail: expect.stringContaining("Can't delete") } });
    const id = t.db.all("products").find((p) => p.sku === "SKU-9001").id;
    expect((await t.call("DELETE", `/inventory/products/${id}`, { token: manager })).status).toBe(204);
    expect((await t.call("DELETE", `/inventory/products/${id}`, { token: manager })).status).toBe(404);
  });
});

describe("CSV product import", () => {
  const header = "sku,name,category,price,cost_price,reorder_threshold,supplier_name,allergens,dietary_tags,kcal,barcode";

  it("creates and updates rows and reports every problem row", async () => {
    const csv = [
      header,
      'SKU-7001,"Sesame Bagels, 6 pack",Bakery,11.5,6.2,40,golden wheat bakers,gluten; sesame,Vegan;,250,8900000007001',
      "SKU-1001,Gala Apples (kg),Produce,9.25,6.4,55,fresh farms co.,,,52,",
      "SKU-7002,No Price,Bakery,,,,,,,,",
      "SKU-7003,Too Cheap,Bakery,0,,,,,,,",
      "SKU-7004,Bad Cost,Bakery,5,-1,,,,,,",
      ",No Sku,Bakery,5,,,,,,,",
      "SKU-7005,,Bakery,5,,,,,,,",
    ].join("\r\n");
    const res = await t.call("POST", "/inventory/products/import", { token: manager, file: csvFile("products.CSV", csv) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 1, updated: 1 });
    expect(res.body.errors).toEqual([
      "Row 4: invalid or missing price, skipped",
      "Row 5: price must be between 0 and 1,000,000, skipped",
      "Row 6: cost_price must be between 0 and 1,000,000, skipped",
      "Row 7: missing sku, skipped",
      "Row 8: name and category are required, skipped",
    ]);

    const bagel = t.db.all("products").find((p) => p.sku === "SKU-7001");
    expect(bagel).toMatchObject({ name: "Sesame Bagels, 6 pack", price: 11.5, cost_price: 6.2, reorder_threshold: 40, allergens: ["gluten", "sesame"], dietary_tags: ["Vegan"], nutrition: { kcal: 250 }, barcode: "8900000007001" });
    expect(bagel.supplier_id).toBe(t.byName("suppliers", "Golden Wheat Bakers").id);
    expect(t.bySku("SKU-1001").price).toBe(9.25);
  });

  it("rejects non-CSV files, empty files and missing columns", async () => {
    const send = (file) => t.call("POST", "/inventory/products/import", { token: manager, file });
    expect((await send(csvFile("products.xlsx", "x"))).body.detail).toMatch(/\.csv/);
    expect((await send(csvFile("a.csv", ""))).body.detail).toBe("Empty file");
    expect((await send(csvFile("a.csv", "sku,name\nA,B"))).body.detail).toBe("CSV is missing required column(s): category, price");
    expect((await t.call("POST", "/inventory/products/import", { token: manager })).status).toBe(422);
    expect((await t.call("POST", "/inventory/products/import", { token: procurement, file: csvFile("a.csv", header) })).status).toBe(403);
  });
});

describe("stock views", () => {
  it("computes shelf-fill per aisle from live batch quantities", async () => {
    const res = await t.call("GET", `/inventory/shelf-fill?store_id=${t.hq.id}`, { token: manager });
    const locations = res.body.map((r) => r.location);
    expect(locations).toEqual([...locations].sort());
    const produce = res.body.find((r) => r.location === "Aisle 02");
    const lots = t.db.all("batches").filter((b) => b.store_id === t.hq.id && b.status === "active" && b.aisle_location.startsWith("Aisle 02"));
    const onHand = lots.reduce((s, b) => s + b.quantity, 0);
    const capacity = lots.reduce((s, b) => s + t.db.get("products", b.product_id).reorder_threshold * 15, 0); // "full shelf" = 15× the reorder point
    expect(produce).toMatchObject({ category: "Produce", pct: Math.round(Math.min(100, (onHand / capacity) * 100)) });
  });

  it("lists batches expiring soon, oldest expiry first", async () => {
    const batch = t.db.all("batches").find((b) => b.store_id === t.hq.id && b.status === "active");
    batch.expires_at = Date.now() + 86_400_000;
    const res = await t.call("GET", `/inventory/expiring-soon?store_id=${t.hq.id}&within_days=2`, { token: manager });
    expect(res.body.map((b) => b.id)).toContain(batch.id);
    const times = res.body.map((b) => Date.parse(b.expires_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect((await t.call("GET", `/inventory/expiring-soon?store_id=${t.hq.id}&within_days=abc`, { token: manager })).status).toBe(422);
  });
});

describe("suppliers", () => {
  const supplier = (over = {}) => ({ name: "Harvest Hub", category: "Produce", contact_email: "", contact_phone: "", payment_terms: "Net 30", cold_chain: "ambient", onboarding_status: "pending", ...over });

  it("sorts by performance score and exposes onboarding fields", async () => {
    const res = await t.call("GET", "/procurement/suppliers", { token: procurement });
    const scores = res.body.map((s) => s.performance_score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(res.body[0]).toMatchObject({ trade_license_no: expect.any(String), trn: expect.any(String), cold_chain: expect.any(String), onboarding_status: "approved" });
  });

  it("creates with defaults, treats a blank email as unset, and validates", async () => {
    const res = await t.call("POST", "/procurement/suppliers", { token: procurement, body: supplier() });
    expect(res).toMatchObject({ status: 201, body: { name: "Harvest Hub", contact_email: null, performance_score: 80, on_time_pct: 90, late_deliveries_30d: 0, contract_end: null } });
    const bad = await t.call("POST", "/procurement/suppliers", { token: procurement, body: supplier({ contact_email: "nope" }) });
    expect(bad.body.detail[0].msg).toMatch(/not a valid email/);
    expect((await t.call("POST", "/procurement/suppliers", { token: procurement, body: supplier({ onboarding_status: "maybe" }) })).body.detail[0].msg).toBe("Input should be 'pending', 'compliance_review', 'approved' or 'suspended'");
    expect((await t.call("POST", "/procurement/suppliers", { token: procurement, body: supplier({ performance_score: 101 }) })).status).toBe(422);
  });

  it("edits, including clearing nullable fields", async () => {
    const id = t.db.all("suppliers").find((s) => s.name === "Harvest Hub").id;
    const edited = await t.call("PATCH", `/procurement/suppliers/${id}`, { token: procurement, body: { contact_email: "orders@harvesthub.internal", contact_phone: "+1-555-0199", onboarding_status: "approved" } });
    expect(edited.body).toMatchObject({ contact_email: "orders@harvesthub.internal", onboarding_status: "approved" });
    const cleared = await t.call("PATCH", `/procurement/suppliers/${id}`, { token: procurement, body: { contact_email: "", contact_phone: null, name: null } });
    expect(cleared.body).toMatchObject({ contact_email: null, contact_phone: null, name: "Harvest Hub" });
    expect((await t.call("PATCH", "/procurement/suppliers/nope", { token: procurement, body: { name: "x" } })).status).toBe(404);
  });

  it("protects suppliers that products or orders depend on", async () => {
    const fresh = t.byName("suppliers", "Fresh Farms Co.");
    expect(await t.call("DELETE", `/procurement/suppliers/${fresh.id}`, { token: procurement })).toMatchObject({ status: 409, body: { detail: expect.stringContaining("Can't delete") } });
    const id = t.db.all("suppliers").find((s) => s.name === "Harvest Hub").id;
    expect((await t.call("DELETE", `/procurement/suppliers/${id}`, { token: procurement })).status).toBe(204);
  });

  it("imports suppliers by name and reports bad rows", async () => {
    const csv = [
      "name,category,contact_email,trn,cold_chain,onboarding_status,performance_score,on_time_pct,late_deliveries_30d",
      "Orchard Direct,Produce,sales@orchard.internal,100999,chilled,approved,88,93.5,1",
      "polar cold logistics,Frozen,,,,,99,,",
      "Bad Email Co,Produce,not-an-email,,,,,,",
      "Bad Status Co,Produce,,,,paused,,,",
      "Bad Score Co,Produce,,,,,150,,",
      ",Produce,,,,,,,",
    ].join("\n");
    const res = await t.call("POST", "/procurement/suppliers/import", { token: procurement, file: csvFile("vendors.csv", csv) });
    expect(res.body).toMatchObject({ created: 1, updated: 1 });
    expect(res.body.errors).toEqual([
      "Row 4: contact_email is not a valid email, skipped",
      "Row 5: onboarding_status must be pending, compliance_review, approved or suspended, skipped",
      "Row 6: performance_score must be 0-100, skipped",
      "Row 7: missing name, skipped",
    ]);
    expect(t.db.all("suppliers").find((s) => s.name === "Polar Cold Logistics").performance_score).toBe(99);
    expect((await t.call("POST", "/procurement/suppliers/import", { token: procurement, file: csvFile("v.csv", "name\nA") })).body.detail).toBe("CSV is missing required column(s): category");
  });
});

describe("reordering, outreach and purchase orders", () => {
  it("detects products below their own reorder point, including stockouts", async () => {
    const milk = t.bySku("SKU-1101");
    for (const b of t.db.all("batches")) if (b.product_id === milk.id && b.store_id === t.hq.id) b.quantity = 0;
    const res = await t.call("GET", `/procurement/reorder-needed?store_id=${t.hq.id}`, { token: manager });
    const row = res.body.find((r) => r.product_id === milk.id);
    expect(row).toMatchObject({ current_stock: 0, reorder_threshold: 70, supplier_name: "Nordic Dairy Direct" });
  });

  it("logs supplier outreach per click without pretending to send anything", async () => {
    const supplier = t.byName("suppliers", "Nordic Dairy Direct");
    const milk = t.bySku("SKU-1101");
    const res = await t.call("POST", `/procurement/suppliers/${supplier.id}/notify`, { token: procurement, body: { store_id: t.hq.id, channel: "email", product_id: milk.id, note: "Urgent" } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ channel: "email", status: "simulated", supplier_id: supplier.id, product_id: milk.id });
    expect(res.body.message).toContain("Whole Milk (2L) is low on stock");
    expect(res.body.message).toContain("this is Diego Ramirez from RetailMind");
    expect(res.body.message).toContain("Note: Urgent");
    expect(res.body.reason).toContain("nothing sent");

    const call = await t.call("POST", `/procurement/suppliers/${supplier.id}/notify`, { token: procurement, body: { store_id: t.hq.id, channel: "call", note: "Check lead times" } });
    expect(call.body.reason).toContain("Check lead times");
    expect(call.body.reason).toContain("nothing dialed");

    expect((await t.call("POST", `/procurement/suppliers/${supplier.id}/notify`, { token: procurement, body: { store_id: t.hq.id, channel: "pigeon" } })).body.detail).toBe("channel must be 'email' or 'call'");
    expect((await t.call("POST", "/procurement/suppliers/nope/notify", { token: procurement, body: { store_id: t.hq.id, channel: "email" } })).status).toBe(404);

    const log = await t.call("GET", `/procurement/contact-log?store_id=${t.hq.id}`, { token: manager });
    expect(log.body).toHaveLength(2);
    expect(Date.parse(log.body[0].created_at)).toBeGreaterThanOrEqual(Date.parse(log.body[1].created_at));
  });

  it("lists orders per store and approves or rejects drafts exactly once", async () => {
    const orders = await t.call("GET", `/procurement/orders?store_id=${t.hq.id}`, { token: manager });
    expect(orders.body).toHaveLength(1);
    expect(orders.body[0]).toMatchObject({ po_number: "PO-1042", status: "draft", total_cost: 3180, created_from: "forecast" });
    expect(orders.body[0].items[0]).toMatchObject({ quantity: 340, unit_cost: 9.35 });

    // Priya lacks Purchase Approvals; Diego too.
    expect((await t.call("PATCH", `/procurement/orders/${orders.body[0].id}/approve`, { token: manager, body: { decided_by: "x" } })).status).toBe(403);
    const approved = await t.call("PATCH", `/procurement/orders/${orders.body[0].id}/approve`, { token: admin, body: { decided_by: "x" } });
    expect(approved.body.status).toBe("approved");
    expect(await t.call("PATCH", `/procurement/orders/${orders.body[0].id}/reject`, { token: admin, body: { decided_by: "x" } })).toMatchObject({ status: 409, body: { detail: "Order is already approved" } });
    expect((await t.call("GET", `/procurement/orders?store_id=${t.hq.id}&status=draft`, { token: manager })).body).toHaveLength(0);

    const riverside = t.byName("stores", "Riverside Mall");
    const draft = (await t.call("GET", `/procurement/orders?store_id=${riverside.id}`, { token: admin })).body[0];
    expect((await t.call("PATCH", `/procurement/orders/${draft.id}/reject`, { token: admin, body: { decided_by: "x" } })).body.status).toBe("rejected");
    expect((await t.call("PATCH", "/procurement/orders/nope/approve", { token: admin, body: { decided_by: "x" } })).status).toBe(404);
    expect((await t.call("PATCH", `/procurement/orders/${draft.id}/approve`, { token: admin, body: {} })).status).toBe(422);
  });
});
