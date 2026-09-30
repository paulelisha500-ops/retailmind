// Runs forecast training off the request path. In a browser the heavy maths goes to its own worker
// so the engine keeps answering other requests; everywhere else (tests, locked-down contexts) it
// simply runs in-thread. Either way the result is identical — training is seeded.
import { ForecastUnavailable, runModel } from "./index.js";

export function createMlRunner() {
  let worker = null;
  let nextId = 1;
  const pending = new Map();

  const start = () => {
    if (worker || typeof Worker === "undefined") return;
    try {
      worker = new Worker(new URL("./ml.worker.js", import.meta.url), { type: "module" });
      worker.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (!job) return;
        pending.delete(data.id);
        if (data.error?.unavailable) job.reject(new ForecastUnavailable(data.error.message));
        else if (data.error) job.reject(new Error(data.error.message));
        else job.resolve(data.result);
      };
      worker.onerror = () => {
        for (const job of pending.values()) job.reject(new Error("Forecast worker failed"));
        pending.clear();
        worker = null;
      };
    } catch {
      worker = null;
    }
  };

  return {
    run(model, history, horizon) {
      start();
      if (!worker) return Promise.resolve().then(() => runModel(model, history, horizon));
      return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        worker.postMessage({ id, model, history, horizon });
      });
    },
  };
}
