import { HttpError, DAY, parseCsv, respond, pyRound } from "../util.js";
import { byName, mustFind } from "../helpers.js";
import * as out from "../serializers.js";
import { f, parseBody, parseQuery, providedKeys } from "../validate.js";

const NUTRITION_COLUMNS = ["kcal", "carbs_g", "fiber_g", "protein_g", "fat_g"];

const ProductCreate = {
  sku: f.str({ min: 1, max: 64 }),
  barcode: f.str({ optional: true }),
  name: f.str({ min: 1, max: 200 }),
  category: f.str({ min: 1, max: 80 }),
  unit: f.str({ default: "each" }),
  price: f.float({ gt: 0, le: 1_000_000 }),
  cost_price: f.float({ optional: true, ge: 0, le: 1_000_000 }),
  reorder_threshold: f.int({ default: 10, ge: 0, le: 1_000_000 }),
  supplier_id: f.str({ optional: true }),
  nutrition: f.dict({ default: {} }),
  allergens: f.list(f.str(), { default: [] }),
  dietary_tags: f.list(f.str(), { default: [] }),
};

const ProductUpdate = {
  name: f.str({ optional: true, min: 1, max: 200 }),
  category: f.str({ optional: true, min: 1, max: 80 }),
  unit: f.str({ optional: true }),
  price: f.float({ optional: true, gt: 0, le: 1_000_000 }),
  cost_price: f.float({ optional: true, ge: 0, le: 1_000_000 }),
  reorder_threshold: f.int({ optional: true, ge: 0, le: 1_000_000 }),
  supplier_id: f.str({ optional: true }),
  nutrition: f.dict({ optional: true }),
  allergens: f.list(f.str(), { optional: true }),
  dietary_tags: f.list(f.str(), { optional: true }),
};

/** Python's float(): plain decimal/exponent notation only, never hex or blanks. NaN when it isn't one. */
export function pyFloat(text) {
  const s = String(text ?? "").trim();
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith("-") ? -Infinity : Infinity;
  return NaN;
}

function assertSupplier(db, id) {
  if (id != null && !db.get("suppliers", id)) throw new HttpError(404, "Supplier not found");
}

export function register(r) {
  r.get("/inventory/products", async (ctx) => {
    await ctx.requireEmployee();
    const { category } = parseQuery({ category: f.str({ optional: true }) }, ctx.query);
    return ctx.db.where("products", (p) => !category || p.category === category).sort(byName).map(out.product);
  });

  r.post("/inventory/products", async (ctx) => {
    await ctx.requireResponsibility("Inventory Monitoring");
    const payload = parseBody(ProductCreate, ctx.body);
    if (ctx.db.all("products").some((p) => p.sku === payload.sku)) throw new HttpError(409, `SKU ${payload.sku} already exists`);
    if (payload.barcode && ctx.db.all("products").some((p) => p.barcode === payload.barcode)) {
      throw new HttpError(409, `Barcode ${payload.barcode} is already assigned to another product`);
    }
    assertSupplier(ctx.db, payload.supplier_id);
    const product = ctx.db.insert("products", { ...payload, created_at: ctx.now });
    return respond(201, out.product(product));
  });

  r.patch("/inventory/products/:id", async (ctx) => {
    await ctx.requireResponsibility("Inventory Monitoring");
    const changes = parseBody(ProductUpdate, ctx.body);
    const product = mustFind(ctx.db, "products", ctx.params.id, "Product not found");
    assertSupplier(ctx.db, changes.supplier_id);
    for (const field of providedKeys(changes)) {
      const value = changes[field];
      if (value === null && field !== "cost_price" && field !== "supplier_id") continue;
      product[field] = value;
    }
    return out.product(product);
  });

  r.delete("/inventory/products/:id", async (ctx) => {
    await ctx.requireResponsibility("Inventory Monitoring");
    const product = mustFind(ctx.db, "products", ctx.params.id, "Product not found");
    const { db } = ctx;
    const inUse =
      db.all("batches").some((b) => b.product_id === product.id) ||
      db.all("purchase_orders").some((p) => p.items.some((i) => i.product_id === product.id)) ||
      db.all("customer_orders").some((o) => o.items.some((i) => i.product_id === product.id)) ||
      db.all("shopping_list_items").some((i) => i.product_id === product.id) ||
      db.all("supplier_contact_log").some((c) => c.product_id === product.id);
    if (inUse) throw new HttpError(409, "Can't delete — this product has batches, orders, or purchase history referencing it");
    db.remove("products", product.id);
    return respond(204);
  });

  // CSV import — the practical equivalent of a Google Sheets upload (File → Download → .csv).
  r.post("/inventory/products/import", async (ctx) => {
    await ctx.requireResponsibility("Inventory Monitoring");
    if (!ctx.file) throw new HttpError(422, [{ loc: ["body", "file"], msg: "Field required", type: "missing" }]);
    if (!ctx.file.name.toLowerCase().endsWith(".csv")) {
      throw new HttpError(422, "Please upload a .csv file (export a Google Sheet as CSV, or any spreadsheet as CSV)");
    }
    const { fieldnames, records } = parseCsv(ctx.file.text);
    if (!fieldnames) throw new HttpError(422, "Empty file");
    const present = new Set(fieldnames.map((h) => (h ?? "").trim().toLowerCase()));
    const missing = ["sku", "name", "category", "price"].filter((c) => !present.has(c)).sort();
    if (missing.length) throw new HttpError(422, `CSV is missing required column(s): ${missing.join(", ")}`);

    const suppliersByName = new Map(ctx.db.all("suppliers").map((s) => [s.name.trim().toLowerCase(), s]));
    let created = 0;
    let updated = 0;
    const errors = [];

    records.forEach((rawRow, index) => {
      const i = index + 2; // row 1 is the header
      const row = Object.fromEntries(Object.entries(rawRow).map(([k, v]) => [(k ?? "").trim().toLowerCase(), (v ?? "").trim()]));

      if (!row.sku) { errors.push(`Row ${i}: missing sku, skipped`); return; }
      const price = pyFloat(row.price);
      if (Number.isNaN(price)) { errors.push(`Row ${i}: invalid or missing price, skipped`); return; }
      if (!(Number.isFinite(price) && price > 0 && price <= 1_000_000)) { errors.push(`Row ${i}: price must be between 0 and 1,000,000, skipped`); return; }
      if (!row.name || !row.category) { errors.push(`Row ${i}: name and category are required, skipped`); return; }

      const nutrition = {};
      for (const col of NUTRITION_COLUMNS) {
        if (row[col]) {
          const n = pyFloat(row[col]);
          if (!Number.isNaN(n)) nutrition[col] = n;
        }
      }

      let costPrice = null;
      if (row.cost_price) {
        const n = pyFloat(row.cost_price);
        if (!Number.isNaN(n)) costPrice = n;
        if (costPrice !== null && !(Number.isFinite(costPrice) && costPrice >= 0 && costPrice <= 1_000_000)) {
          errors.push(`Row ${i}: cost_price must be between 0 and 1,000,000, skipped`);
          return;
        }
      }

      const supplier = row.supplier_name ? suppliersByName.get(row.supplier_name.toLowerCase()) : null;
      const split = (text) => (text ?? "").split(";").map((x) => x.trim()).filter(Boolean);
      const fields = {
        name: row.name, category: row.category, price, cost_price: costPrice, barcode: row.barcode || null,
        unit: row.unit || "each", reorder_threshold: /^\d+$/.test(row.reorder_threshold ?? "") ? parseInt(row.reorder_threshold, 10) : 10,
        supplier_id: supplier ? supplier.id : null, allergens: split(row.allergens), dietary_tags: split(row.dietary_tags), nutrition,
      };

      const existing = ctx.db.all("products").find((p) => p.sku === row.sku);
      if (existing) {
        Object.assign(existing, fields);
        updated += 1;
      } else {
        ctx.db.insert("products", { sku: row.sku, ...fields, created_at: ctx.now });
        created += 1;
      }
    });

    return { created, updated, errors };
  });

  // FEFO in practice: batches closest to their expiry date first.
  r.get("/inventory/expiring-soon", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id, within_days } = parseQuery({ store_id: f.str(), within_days: f.int({ default: 7 }) }, ctx.query);
    const cutoff = ctx.now + within_days * DAY;
    return ctx.db
      .where("batches", (b) => b.store_id === store_id && b.status === "active" && b.expires_at <= cutoff)
      .sort((a, b) => a.expires_at - b.expires_at)
      .map(out.batch);
  });

  // Per-aisle shelf-fill %, from live batch quantities against each product's reorder point.
  r.get("/inventory/shelf-fill", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id } = parseQuery({ store_id: f.str() }, ctx.query);
    const byAisle = new Map();
    for (const b of ctx.db.where("batches", (x) => x.store_id === store_id && x.status === "active")) {
      const product = ctx.db.get("products", b.product_id);
      if (!product) continue;
      const aisle = (b.aisle_location || "Unassigned").split("·")[0].trim();
      const entry = byAisle.get(aisle) ?? { current: 0, capacity: 0, category: product.category };
      entry.current += b.quantity;
      entry.capacity += product.reorder_threshold * 15; // "full shelf" reference: 15× the reorder point
      byAisle.set(aisle, entry);
    }
    return [...byAisle.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([location, v]) => ({
        location, category: v.category, pct: v.capacity ? pyRound(Math.min(100, (v.current / v.capacity) * 100), 0) : 0,
      }));
  });
}
