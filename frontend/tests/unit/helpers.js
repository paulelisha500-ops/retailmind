import { SEED_PASSWORD } from "../../src/engine/accounts.js";
import { createEngine } from "../../src/engine/index.js";

/** A fresh, isolated workspace plus a tiny HTTP-ish client against it. */
export async function boot(options = {}) {
  // The clock runs in real time from `options.now`, and tests can jump it forward (time.offset) to
  // "return" days later without waiting.
  const time = { base: options.now ?? Date.now(), started: Date.now(), offset: 0 };
  const clock = () => time.base + (Date.now() - time.started) + time.offset;
  const engine = await createEngine({ persist: false, clock });

  const call = (method, path, { token, body, query, file } = {}) => {
    const url = new URL(path, "http://engine.test");
    return engine.handle({ method, path: url.pathname, query: { ...Object.fromEntries(url.searchParams), ...query }, body, token, file });
  };

  const tokens = new Map();
  const login = async (email, password = SEED_PASSWORD) => {
    if (tokens.has(email) && password === SEED_PASSWORD) return tokens.get(email);
    const res = await call("POST", "/auth/login", { body: { email, password } });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
    if (password === SEED_PASSWORD) tokens.set(email, res.body.access_token);
    return res.body.access_token;
  };

  const as = async (who) => {
    const emails = {
      admin: "marcus@retailmind.app", manager: "priya@retailmind.app", staff: "diego@retailmind.app",
      inspector: "aisha@retailmind.app", customer: "layla@members.retailmind.app", riverside: "hana@retailmind.app",
    };
    return login(emails[who] ?? who);
  };

  const hq = engine.db.all("stores").find((s) => s.is_headquarters);
  const byName = (table, name) => engine.db.all(table).find((r) => r.name === name);
  const bySku = (sku) => engine.db.all("products").find((p) => p.sku === sku);

  return { engine, db: engine.db, call, login, as, hq, byName, bySku, time };
}

export const csvFile = (name, text) => ({ name, text });
