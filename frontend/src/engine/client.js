// Main-thread handle to the engine. Prefers a dedicated worker; if workers aren't available it
// runs the engine in-page instead, so the app still works (just on the UI thread).
let worker = null;
let fallback = null;
let nextId = 1;
const pending = new Map();

function startWorker() {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      pending.delete(data.id);
      job.resolve(data.response);
    };
    worker.onerror = () => {
      // The worker itself died: fail what's in flight and fall back to in-page on the next request.
      for (const job of pending.values()) job.resolve({ status: 500, body: { detail: "Internal Server Error" } });
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

async function inPage(request) {
  fallback ??= import("./index.js").then((m) => m.createEngine());
  return (await fallback).handle(request);
}

/** Start loading the workspace now (call early so the first real request isn't the one that pays). */
export function warmEngine() {
  if (!startWorker()) fallback ??= import("./index.js").then((m) => m.createEngine());
}

export function engineRequest(request) {
  if (startWorker()) {
    return new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, { resolve });
      worker.postMessage({ id, request });
    });
  }
  return inPage(request);
}
