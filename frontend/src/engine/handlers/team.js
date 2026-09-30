import { ACCESS_LEVELS } from "../constants.js";
import { hashPassword } from "../crypto.js";
import * as out from "../serializers.js";
import { HttpError, respond, tokenUrlsafe } from "../util.js";
import { f, parseBody, parseQuery } from "../validate.js";

const TeamMemberCreate = {
  name: f.str({ min: 1, max: 120, strip: true, nonblank: true }),
  email: f.email({ lower: true }),
  department: f.str({ min: 1, max: 80, strip: true, nonblank: true }),
  title: f.str({ min: 1, max: 120, strip: true, nonblank: true }),
  access_level: f.str(),
  store_id: f.str(),
  responsibilities: f.list(f.str(), { default: [] }),
};

/** Rows other tables point at: removing these would orphan orders, tasks, alerts or approvals. */
const isReferenced = (db, userId) =>
  db.all("tasks").some((t) => t.assigned_to === userId) ||
  db.all("alerts").some((a) => a.assigned_to === userId) ||
  db.all("customer_orders").some((o) => o.cashier_id === userId || o.customer_id === userId) ||
  db.all("purchase_orders").some((p) => p.approved_by === userId) ||
  db.all("supplier_contact_log").some((c) => c.triggered_by === userId) ||
  db.all("shopping_list_items").some((i) => i.customer_id === userId);

export function register(r) {
  r.get("/team", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id } = parseQuery({ store_id: f.str({ optional: true }) }, ctx.query);
    return ctx.db
      .where("users", (u) => u.role === "employee" && (!store_id || u.store_id === store_id))
      .map(out.teamMember);
  });

  r.post("/team", async (ctx) => {
    await ctx.requireAdmin();
    const payload = parseBody(TeamMemberCreate, ctx.body);
    if (ctx.db.all("users").some((u) => u.email.toLowerCase() === payload.email)) {
      throw new HttpError(409, "A user with that email already exists");
    }
    if (!ctx.db.get("stores", payload.store_id)) throw new HttpError(404, "Store not found");
    if (!ACCESS_LEVELS.includes(payload.access_level)) throw new HttpError(422, "access_level must be staff, manager, or admin");

    // A new hire gets a one-time temporary password, shown to the admin once so it can be handed over.
    const temporaryPassword = tokenUrlsafe(9);
    const member = ctx.db.insert("users", {
      name: payload.name, email: payload.email, hashed_password: await hashPassword(temporaryPassword), role: "employee",
      phone: null, department: payload.department, title: payload.title, access_level: payload.access_level,
      responsibilities: payload.responsibilities, store_id: payload.store_id, loyalty_points: 0, preferred_store_id: null,
      notify_restock: true, notify_security: true, notify_orders: true, created_at: ctx.now,
    });
    return respond(201, { ...out.teamMember(member), temporary_password: temporaryPassword });
  });

  r.delete("/team/:id", async (ctx) => {
    const admin = await ctx.requireAdmin();
    const member = ctx.db.get("users", ctx.params.id);
    if (!member || member.role !== "employee") throw new HttpError(404, "Team member not found");
    if (member.id === admin.id) throw new HttpError(409, "You can't remove your own account");
    const otherAdmins = ctx.db.where("users", (u) => u.role === "employee" && u.access_level === "admin" && u.id !== member.id);
    if (member.access_level === "admin" && otherAdmins.length === 0) throw new HttpError(409, "You can't remove the last admin");
    if (isReferenced(ctx.db, member.id)) {
      throw new HttpError(409, "Can't remove this member — they have orders, tasks, or approvals on record");
    }
    ctx.db.remove("users", member.id);
    return respond(204);
  });
}
