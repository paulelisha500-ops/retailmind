// Dedicated worker hosting the engine, so every request is answered off the UI thread.
import { createEngine } from "./index.js";

let booting = null;
const engine = () => (booting ??= createEngine());
engine(); // start seeding / loading the workspace immediately, before the first request arrives

self.onmessage = async ({ data }) => {
  if (data.flush) { // the page is being hidden or closed: save now instead of waiting for the debounce
    (await engine()).flush();
    return;
  }
  const { id, request } = data;
  try {
    const response = await (await engine()).handle(request);
    self.postMessage({ id, response });
  } catch (error) {
    console.error("engine worker failure", error);
    self.postMessage({ id, response: { status: 500, body: { detail: "Internal Server Error" } } });
  }
};
