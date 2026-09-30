// Per-request context: parsed inputs plus the auth/RBAC checks the routes declare.
import { verifyJwt } from "./crypto.js";
import { HttpError } from "./util.js";

export const hasResponsibility = (user, name) =>
  user.access_level === "admin" || (user.responsibilities ?? []).includes(name);

export class Context {
  constructor({ db, runtime, request, params }) {
    this.db = db;
    this.rt = runtime;
    this.method = request.method;
    this.path = request.path;
    this.query = request.query ?? {};
    this.body = request.body;
    this.file = request.file ?? null;
    this.token = request.token ?? null;
    this.params = params;
    this.now = runtime.clock();
    this._user = undefined;
  }

  async currentUser() {
    if (this._user) return this._user;
    if (!this.token) throw new HttpError(401, "Not authenticated", { "WWW-Authenticate": "Bearer" });
    const invalid = () => new HttpError(401, "Could not validate credentials", { "WWW-Authenticate": "Bearer" });
    const payload = await verifyJwt(this.token, this.db.meta.jwtSecret);
    if (!payload?.sub) throw invalid();
    const user = this.db.get("users", payload.sub);
    if (!user) throw invalid();
    this._user = user;
    return user;
  }

  async requireEmployee() {
    const user = await this.currentUser();
    if (user.role !== "employee") throw new HttpError(403, "Staff access required");
    return user;
  }

  async requireCustomer() {
    const user = await this.currentUser();
    if (user.role !== "customer") throw new HttpError(403, "Customer account required");
    return user;
  }

  async requireAdmin() {
    const user = await this.requireEmployee();
    if (user.access_level !== "admin") throw new HttpError(403, "Admin access required");
    return user;
  }

  async requireResponsibility(name) {
    const user = await this.requireEmployee();
    if (!hasResponsibility(user, name)) throw new HttpError(403, `Requires the '${name}' responsibility`);
    return user;
  }
}
