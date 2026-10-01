import { ACCESS_TOKEN_TTL_SECONDS, LOGIN_WINDOW_MS, MAX_FAILED_PER_CLIENT, MAX_FAILED_PER_EMAIL } from "../constants.js";
import { signJwt, verifyPassword } from "../crypto.js";
import { userMe } from "../serializers.js";
import { HttpError } from "../util.js";
import { f, parseBody, providedKeys } from "../validate.js";

const LoginRequest = { email: f.email({ lower: true }), password: f.str({ max: 256 }) };
const PreferencesUpdate = {
  preferred_store_id: f.str({ optional: true }),
  notify_restock: f.bool({ optional: true }),
  notify_security: f.bool({ optional: true }),
  notify_orders: f.bool({ optional: true }),
};

const recentFailures = (rt, key, now) => {
  const recent = (rt.loginFailures.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  rt.loginFailures.set(key, recent);
  return recent;
};

export function register(r) {
  r.post("/auth/login", async (ctx) => {
    const payload = parseBody(LoginRequest, ctx.body);
    const keys = [["client", MAX_FAILED_PER_CLIENT], [`email:${payload.email}`, MAX_FAILED_PER_EMAIL]];
    const now = ctx.now;

    for (const [key, limit] of keys) {
      const recent = recentFailures(ctx.rt, key, now);
      if (recent.length >= limit) {
        const retryAfter = Math.floor((LOGIN_WINDOW_MS - (now - recent[0])) / 1000) + 1;
        throw new HttpError(429, "Too many failed sign-in attempts. Try again in a few minutes.", { "Retry-After": String(retryAfter) });
      }
    }

    const user = ctx.db.all("users").find((u) => u.email.toLowerCase() === payload.email);
    const ok = await verifyPassword(payload.password, user?.hashed_password ?? null);
    if (!user || !ok) {
      for (const [key] of keys) ctx.rt.loginFailures.get(key).push(now);
      throw new HttpError(401, "Incorrect email or password");
    }
    ctx.rt.loginFailures.delete(keys[1][0]);

    const exp = Math.floor(now / 1000) + ACCESS_TOKEN_TTL_SECONDS;
    return {
      access_token: await signJwt({ sub: user.id, exp }, ctx.db.meta.jwtSecret),
      token_type: "bearer",
      role: user.role,
      access_level: user.access_level ?? null,
    };
  });

  r.get("/auth/me", async (ctx) => userMe(await ctx.currentUser()));

  r.patch("/auth/me", async (ctx) => {
    const user = await ctx.currentUser();
    const changes = parseBody(PreferencesUpdate, ctx.body);
    const provided = providedKeys(changes);
    const storeId = provided.has("preferred_store_id") ? changes.preferred_store_id : null;
    if (storeId != null && !ctx.db.get("stores", storeId)) throw new HttpError(404, "Store not found");
    for (const field of provided) {
      const value = changes[field];
      if (value === null && field !== "preferred_store_id") continue; // the notify_* toggles are never null
      user[field] = value;
    }
    return userMe(user);
  });
}
