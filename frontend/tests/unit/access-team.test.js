import { beforeAll, describe, expect, it } from "vitest";
import { SEED_PASSWORD } from "../../src/engine/accounts.js";
import { boot } from "./helpers.js";

let t;
beforeAll(async () => { t = await boot(); });

const newMember = (over = {}) => ({
  name: "Nadia Rahman", email: "nadia@retailmind.app", department: "Inventory & Shelf Ops", title: "Shelf Associate",
  access_level: "staff", store_id: t.hq.id, responsibilities: ["Inventory Monitoring"], ...over,
});

describe("role-based access", () => {
  it("keeps staff screens away from customers", async () => {
    const token = await t.as("customer");
    for (const path of [`/team?store_id=${t.hq.id}`, `/alerts?store_id=${t.hq.id}`, `/tasks?store_id=${t.hq.id}`, "/procurement/suppliers", "/inventory/products"]) {
      expect(await t.call("GET", path, { token })).toMatchObject({ status: 403, body: { detail: "Staff access required" } });
    }
  });

  it("keeps the customer app away from staff", async () => {
    expect(await t.call("GET", "/customer/products", { token: await t.as("staff") })).toMatchObject({ status: 403, body: { detail: "Customer account required" } });
  });

  it("requires sign-in everywhere", async () => {
    for (const path of ["/stores", "/team?store_id=x", "/customer/offers", "/analytics/summary"]) {
      expect((await t.call("GET", path)).status).toBe(401);
    }
  });

  it("limits revenue analytics to admins", async () => {
    for (const who of ["manager", "staff"]) {
      expect(await t.call("GET", "/analytics/summary", { token: await t.as(who) })).toMatchObject({ status: 403, body: { detail: "Admin access required" } });
      expect((await t.call("GET", "/analytics/pnl", { token: await t.as(who) })).status).toBe(403);
    }
    expect((await t.call("GET", "/analytics/summary", { token: await t.as("admin") })).status).toBe(200);
  });

  it("gates writes on the specific responsibility, with admins always passing", async () => {
    const product = { sku: "SKU-RBAC", name: "Test Item", category: "Bakery", price: 5 };
    // Diego manages suppliers but not inventory; Priya is the reverse; Marcus is an admin.
    expect(await t.call("POST", "/inventory/products", { token: await t.as("staff"), body: product })).toMatchObject({ status: 403, body: { detail: "Requires the 'Inventory Monitoring' responsibility" } });
    expect((await t.call("POST", "/inventory/products", { token: await t.as("manager"), body: product })).status).toBe(201);
    expect(await t.call("POST", "/procurement/suppliers", { token: await t.as("manager"), body: { name: "X", category: "Bakery" } })).toMatchObject({ status: 403, body: { detail: "Requires the 'Supplier Management' responsibility" } });
    expect((await t.call("POST", "/procurement/suppliers", { token: await t.as("staff"), body: { name: "Acme Bakers", category: "Bakery" } })).status).toBe(201);
    expect((await t.call("POST", "/procurement/suppliers", { token: await t.as("admin"), body: { name: "Admin Supplies", category: "Frozen" } })).status).toBe(201);
  });

  it("checks authentication before validating the body", async () => {
    expect((await t.call("POST", "/team", { body: {} })).status).toBe(401);
    expect((await t.call("POST", "/team", { token: await t.as("manager"), body: {} })).status).toBe(403);
  });
});

describe("team & access", () => {
  it("lists only employees, optionally scoped to a store", async () => {
    const token = await t.as("manager");
    const all = await t.call("GET", "/team", { token });
    expect(all.body).toHaveLength(7);
    expect(all.body.every((m) => m.department && m.access_level)).toBe(true);
    const hq = await t.call("GET", `/team?store_id=${t.hq.id}`, { token });
    expect(hq.body.map((m) => m.name).sort()).toEqual(["Aisha Khan", "Diego Ramirez", "Marcus Tan", "Priya Sharma"]);
    expect(hq.body[0]).not.toHaveProperty("hashed_password");
  });

  it("lets an admin add a member who can then sign in with the one-time password", async () => {
    const admin = await t.as("admin");
    const res = await t.call("POST", "/team", { token: admin, body: newMember() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Nadia Rahman", email: "nadia@retailmind.app", access_level: "staff" });
    expect(res.body.temporary_password).toMatch(/^[\w-]{12}$/);

    const signIn = await t.call("POST", "/auth/login", { body: { email: "nadia@retailmind.app", password: res.body.temporary_password } });
    expect(signIn.status).toBe(200);
    // And the standard password does not work for them.
    expect((await t.call("POST", "/auth/login", { body: { email: "nadia@retailmind.app", password: SEED_PASSWORD } })).status).toBe(401);
  });

  it("validates new members", async () => {
    const admin = await t.as("admin");
    expect(await t.call("POST", "/team", { token: admin, body: newMember({ email: "MARCUS@retailmind.app" }) })).toMatchObject({ status: 409, body: { detail: "A user with that email already exists" } });
    expect(await t.call("POST", "/team", { token: admin, body: newMember({ email: "new@retailmind.app", store_id: "nope" }) })).toMatchObject({ status: 404, body: { detail: "Store not found" } });
    expect(await t.call("POST", "/team", { token: admin, body: newMember({ email: "new@retailmind.app", access_level: "owner" }) })).toMatchObject({ status: 422, body: { detail: "access_level must be staff, manager, or admin" } });
    const blank = await t.call("POST", "/team", { token: admin, body: newMember({ email: "new@retailmind.app", name: "   " }) });
    expect(blank.status).toBe(422);
    expect(blank.body.detail[0]).toMatchObject({ loc: ["body", "name"], msg: "Value error, must not be blank" });
    expect((await t.call("POST", "/team", { token: admin, body: newMember({ email: "bad-email" }) })).status).toBe(422);
  });

  it("protects accounts that have history, and the admin's own account", async () => {
    const admin = await t.as("admin");
    const marcus = t.db.all("users").find((u) => u.email === "marcus@retailmind.app");
    const priya = t.db.all("users").find((u) => u.email === "priya@retailmind.app");
    expect(await t.call("DELETE", `/team/${marcus.id}`, { token: admin })).toMatchObject({ status: 409, body: { detail: "You can't remove your own account" } });
    expect(await t.call("DELETE", `/team/${priya.id}`, { token: admin })).toMatchObject({ status: 409, body: { detail: "Can't remove this member — they have orders, tasks, or approvals on record" } });
    expect((await t.call("DELETE", "/team/does-not-exist", { token: admin })).status).toBe(404);
  });

  it("removes a member with no history", async () => {
    const admin = await t.as("admin");
    const created = await t.call("POST", "/team", { token: admin, body: newMember({ email: "temp@retailmind.app", name: "Temp Hire" }) });
    expect((await t.call("DELETE", `/team/${created.body.id}`, { token: admin })).status).toBe(204);
    const list = await t.call("GET", `/team?store_id=${t.hq.id}`, { token: admin });
    expect(list.body.find((m) => m.id === created.body.id)).toBeUndefined();
  });

  it("does not let a customer id be removed through the team route", async () => {
    const layla = t.db.all("users").find((u) => u.role === "customer");
    expect((await t.call("DELETE", `/team/${layla.id}`, { token: await t.as("admin") })).status).toBe(404);
  });
});

describe("stores, tasks, alerts", () => {
  it("lists stores alphabetically for any signed-in user", async () => {
    const res = await t.call("GET", "/stores", { token: await t.as("customer") });
    expect(res.body.map((s) => s.name)).toEqual(["Airport Plaza", "Downtown Central", "North Hills", "Riverside Mall"]);
    expect(res.body.find((s) => s.name === "Downtown Central").is_headquarters).toBe(true);
  });

  it("orders tasks open-first, newest-first, and toggles them", async () => {
    const token = await t.as("staff");
    const res = await t.call("GET", `/tasks?store_id=${t.hq.id}`, { token });
    expect(res.body).toHaveLength(6);
    const firstDone = res.body.findIndex((x) => x.done);
    expect(res.body.slice(firstDone).every((x) => x.done)).toBe(true);
    expect((await t.call("GET", "/tasks", { token })).status).toBe(422);

    const open = res.body.find((x) => !x.done);
    const toggled = await t.call("PATCH", `/tasks/${open.id}/toggle`, { token });
    expect(toggled.body.done).toBe(true);
    expect((await t.call("PATCH", `/tasks/${open.id}/toggle`, { token })).body.done).toBe(false);
    expect((await t.call("PATCH", "/tasks/nope/toggle", { token })).status).toBe(404);
  });

  it("filters and resolves alerts", async () => {
    const token = await t.as("inspector");
    const all = await t.call("GET", `/alerts?store_id=${t.hq.id}`, { token });
    expect(all.body.map((a) => a.kind).sort()).toEqual(["quality", "stock", "theft"]);
    const theft = all.body.find((a) => a.kind === "theft");
    const resolved = await t.call("PATCH", `/alerts/${theft.id}/resolve`, { token });
    expect(resolved.body.status).toBe("resolved");
    const open = await t.call("GET", `/alerts?store_id=${t.hq.id}&status=open`, { token });
    expect(open.body.map((a) => a.id)).not.toContain(theft.id);
    expect((await t.call("PATCH", "/alerts/nope/resolve", { token })).status).toBe(404);
  });

  it("builds notifications from the user's own preferences", async () => {
    const token = await t.as("manager");
    const before = (await t.call("GET", `/notifications?store_id=${t.hq.id}`, { token })).body;
    expect(before.some((n) => n.kind === "alert")).toBe(true);
    expect(before.every((n) => n.created_at.endsWith("Z"))).toBe(true);
    await t.call("PATCH", "/auth/me", { token, body: { notify_restock: false, notify_security: false, notify_orders: false } });
    expect((await t.call("GET", `/notifications?store_id=${t.hq.id}`, { token })).body).toEqual([]);
  });
});
