// The browser edition's backend: the same REST surface as the server, answered locally.
// Requests in → { status, body } out; state lives in IndexedDB so the workspace survives reloads.
import { Context } from "./context.js";
import { createMlRunner } from "./ml/runner.js";
import { attachPersistence, loadState } from "./persist.js";
import { Router } from "./router.js";
import { seedWorkspace } from "./seed.js";
import { Database, SCHEMA_VERSION, alignClock } from "./store.js";
import { HttpError } from "./util.js";

import * as alerts from "./handlers/basics.js";
import * as analytics from "./handlers/analytics.js";
import * as assistant from "./handlers/assistant.js";
import * as auth from "./handlers/auth.js";
import * as customer from "./handlers/customer.js";
import * as forecast from "./handlers/forecast.js";
import * as inventory from "./handlers/inventory.js";
import * as pos from "./handlers/pos.js";
import * as procurement from "./handlers/procurement.js";
import * as team from "./handlers/team.js";
import * as warehouse from "./handlers/warehouse.js";
import * as workspace from "./handlers/workspace.js";

const MODULES = [auth, team, alerts, inventory, procurement, forecast, analytics, assistant, customer, warehouse, pos, workspace];

export async function createEngine({ persist = true, clock = Date.now } = {}) {
  const now = clock();
  const db = new Database();
  const saved = persist ? await loadState() : null;
  if (saved?.version === SCHEMA_VERSION && saved.meta?.jwtSecret) {
    db.load(saved);
    alignClock(db, now);
  } else {
    await seedWorkspace(db, now);
  }

  const rt = {
    clock,
    loginFailures: new Map(),
    forecastCache: new Map(),
    ml: createMlRunner(),
    reset: async () => {
      await seedWorkspace(db, clock());
      rt.forecastCache.clear();
      rt.loginFailures.clear();
    },
  };

  const persistence = persist ? attachPersistence(db, { onExternalChange: () => rt.forecastCache.clear() }) : null;
  await persistence?.flush();

  const router = new Router();
  for (const mod of MODULES) mod.register(router);

  async function handle(request) {
    const method = (request.method ?? "GET").toUpperCase();
    const match = router.match(method, request.path);
    if (!match) return { status: 404, body: { detail: "Not Found" } };
    if (match.methodNotAllowed) return { status: 405, body: { detail: "Method Not Allowed" } };

    const ctx = new Context({ db, runtime: rt, request: { ...request, method }, params: match.params });
    try {
      const result = await match.route.handler(ctx);
      const wrapped = result?.__response ? result : { status: 200, body: result };
      if (method !== "GET") db.touch();
      return { status: wrapped.status, body: wrapped.body };
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, body: { detail: error.detail }, headers: error.headers };
      console.error("engine error", method, request.path, error);
      return { status: 500, body: { detail: "Internal Server Error" } };
    }
  }

  return { handle, db, clock, flush: () => persistence?.flush(), close: () => persistence?.close() };
}
