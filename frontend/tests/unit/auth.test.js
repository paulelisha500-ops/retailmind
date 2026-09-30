import { beforeAll, describe, expect, it } from "vitest";
import { signJwt } from "../../src/engine/crypto.js";
import { SEED_ACCOUNTS, SEED_PASSWORD } from "../../src/engine/accounts.js";
import { boot } from "./helpers.js";

let t;
beforeAll(async () => { t = await boot(); });

describe("seed", () => {
  it("builds the full workspace", () => {
    const count = (table) => t.db.all(table).length;
    expect(count("stores")).toBe(4);
    expect(count("suppliers")).toBe(5);
    expect(count("products")).toBe(15);
    expect(count("users")).toBe(12);
    expect(count("sales_records")).toBe(4 * 5 * 90);
    expect(count("warehouse_zones")).toBe(16);
    expect(count("offers")).toBe(3);
    expect(count("purchase_orders")).toBe(4);
    expect(t.db.all("stores").filter((s) => s.is_headquarters)).toHaveLength(1);
  });

  it("is deterministic apart from ids", async () => {
    const other = await boot({ now: t.db.meta.seededAt });
    const storeName = (db) => (id) => db.get("stores", id).name;
    const sales = (x) => x.db.all("sales_records").map((r) => [storeName(x.db)(r.store_id), r.category, r.date, r.units_sold, r.revenue]);
    expect(sales(other)).toEqual(sales(t));
    expect(other.db.all("batches").map((b) => b.quantity)).toEqual(t.db.all("batches").map((b) => b.quantity));
  });

  it("never stores passwords in the clear and gives every quick sign-in account a login", async () => {
    for (const u of t.db.all("users")) expect(JSON.stringify(u.hashed_password ?? "")).not.toContain(SEED_PASSWORD);
    for (const a of SEED_ACCOUNTS) expect(await t.login(a.email)).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
  });

  it("keeps loyalty-only members unable to sign in", async () => {
    const res = await t.call("POST", "/auth/login", { body: { email: "omar.alsuwaidi@members.retailmind.app", password: SEED_PASSWORD } });
    expect(res.status).toBe(401);
  });
});

describe("login", () => {
  it("returns a bearer token with role and access level", async () => {
    const res = await t.call("POST", "/auth/login", { body: { email: "MARCUS@retailmind.app ", password: SEED_PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ token_type: "bearer", role: "employee", access_level: "admin" });
    const cust = await t.call("POST", "/auth/login", { body: { email: "layla@members.retailmind.app", password: SEED_PASSWORD } });
    expect(cust.body).toMatchObject({ role: "customer", access_level: null });
  });

  it("uses one generic message for a wrong password and an unknown email", async () => {
    const wrong = await t.call("POST", "/auth/login", { body: { email: "priya@retailmind.app", password: "nope" } });
    const unknown = await t.call("POST", "/auth/login", { body: { email: "ghost@retailmind.app", password: "nope" } });
    expect(wrong).toMatchObject({ status: 401, body: { detail: "Incorrect email or password" } });
    expect(unknown).toMatchObject({ status: 401, body: { detail: "Incorrect email or password" } });
  });

  it("validates the payload", async () => {
    const res = await t.call("POST", "/auth/login", { body: { email: "not-an-email", password: "x" } });
    expect(res.status).toBe(422);
    expect(res.body.detail[0].loc).toEqual(["body", "email"]);
    expect((await t.call("POST", "/auth/login", { body: { email: "a@b.co" } })).status).toBe(422);
  });

  it("rate-limits repeated failures per email, then recovers after a success elsewhere", async () => {
    const fresh = await boot();
    let last;
    for (let i = 0; i < 8; i++) last = await fresh.call("POST", "/auth/login", { body: { email: "diego@retailmind.app", password: "bad" } });
    expect(last.status).toBe(401);
    const blocked = await fresh.call("POST", "/auth/login", { body: { email: "diego@retailmind.app", password: SEED_PASSWORD } });
    expect(blocked.status).toBe(429);
    expect(blocked.headers["Retry-After"]).toBeDefined();
    // Another account is unaffected.
    expect((await fresh.call("POST", "/auth/login", { body: { email: "priya@retailmind.app", password: SEED_PASSWORD } })).status).toBe(200);
  });
});

describe("tokens", () => {
  it("rejects missing, malformed, tampered and expired tokens", async () => {
    expect(await t.call("GET", "/auth/me")).toMatchObject({ status: 401, body: { detail: "Not authenticated" } });
    expect(await t.call("GET", "/auth/me", { token: "garbage" })).toMatchObject({ status: 401, body: { detail: "Could not validate credentials" } });

    const good = await t.as("admin");
    const [h, p, s] = good.split(".");
    const tampered = `${h}.${p.slice(0, -2)}xx.${s}`;
    expect((await t.call("GET", "/auth/me", { token: tampered })).status).toBe(401);

    const expired = await signJwt({ sub: t.db.all("users")[0].id, exp: Math.floor(Date.now() / 1000) - 60 }, t.db.meta.jwtSecret);
    expect((await t.call("GET", "/auth/me", { token: expired })).status).toBe(401);

    const unknownUser = await signJwt({ sub: "nobody", exp: Math.floor(Date.now() / 1000) + 600 }, t.db.meta.jwtSecret);
    expect((await t.call("GET", "/auth/me", { token: unknownUser })).status).toBe(401);

    const wrongKey = await signJwt({ sub: t.db.all("users")[0].id, exp: Math.floor(Date.now() / 1000) + 600 }, "some-other-secret");
    expect((await t.call("GET", "/auth/me", { token: wrongKey })).status).toBe(401);
  });

  it("returns the profile without any secret fields", async () => {
    const res = await t.call("GET", "/auth/me", { token: await t.as("manager") });
    expect(res.body).toMatchObject({ name: "Priya Sharma", access_level: "manager", role: "employee" });
    expect(res.body).not.toHaveProperty("hashed_password");
  });
});

describe("profile preferences", () => {
  it("updates notification toggles and the preferred store", async () => {
    const token = await t.as("customer");
    const res = await t.call("PATCH", "/auth/me", { token, body: { notify_orders: false, preferred_store_id: t.hq.id } });
    expect(res.body).toMatchObject({ notify_orders: false, preferred_store_id: t.hq.id });
    const cleared = await t.call("PATCH", "/auth/me", { token, body: { preferred_store_id: null } });
    expect(cleared.body.preferred_store_id).toBeNull();
  });

  it("ignores null toggles and rejects an unknown store", async () => {
    const token = await t.as("staff");
    const res = await t.call("PATCH", "/auth/me", { token, body: { notify_restock: null } });
    expect(res.body.notify_restock).toBe(true);
    expect(await t.call("PATCH", "/auth/me", { token, body: { preferred_store_id: "nope" } })).toMatchObject({ status: 404, body: { detail: "Store not found" } });
  });
});

describe("routing", () => {
  it("404s unknown paths and 405s the wrong verb", async () => {
    expect(await t.call("GET", "/nowhere")).toMatchObject({ status: 404 });
    expect(await t.call("DELETE", "/auth/me")).toMatchObject({ status: 405 });
  });

  it("exposes health and workspace info without signing in", async () => {
    expect((await t.call("GET", "/health")).body.status).toBe("ok");
    expect((await t.call("GET", "/workspace")).body.edition).toBe("browser");
  });
});
