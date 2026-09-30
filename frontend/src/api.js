// One entry point for every request the UI makes. Two editions share the same REST surface:
//   • browser (default): answered by the in-page engine (src/engine) — no server, works on any static host
//   • server: sent over the network to the FastAPI backend (VITE_BACKEND=server, VITE_API_URL=…)
import { engineRequest, warmEngine } from "./engine/client.js";

export const EDITION = import.meta.env.VITE_BACKEND === "server" ? "server" : "browser";

// `??`, not `||`: an explicitly empty VITE_API_URL means "same origin" (the single-container Docker
// Space build sets it that way). Unset — local dev — falls back to the local API.
const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8002";

export const UNAUTHORIZED_EVENT = "rm:unauthorized";

export class ApiError extends Error {
  constructor(status, detail) {
    super(formatDetail(detail));
    this.status = status;
  }
}

// The API sends a string for handled errors but an array of {loc, msg} for 422 validation errors.
function formatDetail(detail) {
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body" && p !== "query").join(" › ") : "";
        const msg = String(d.msg || "is invalid").replace(/^Value error, /, "");
        return field ? `${field}: ${msg}` : msg;
      })
      .join("; ");
  }
  return "Request failed";
}

if (EDITION === "browser") warmEngine(); // start loading the workspace before the first request needs it

async function viaEngine(path, { method, token, body, formData }) {
  const url = new URL(path, "http://engine.local");
  let file = null;
  const upload = formData?.get("file");
  if (upload) file = { name: upload.name, text: await upload.text() };
  const res = await engineRequest({ method, path: url.pathname, query: Object.fromEntries(url.searchParams), body, file, token });
  return { ok: res.status < 400, status: res.status, json: async () => res.body };
}

async function viaNetwork(path, { method, token, body, formData }) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  // FormData sets its own multipart Content-Type (with boundary) — never set it manually.
  if (body !== undefined && !formData) headers["Content-Type"] = "application/json";
  return fetch(API_BASE + path, {
    method,
    headers,
    body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
  });
}

export async function apiFetch(path, { method = "GET", token, body, formData } = {}) {
  let res;
  try {
    res = await (EDITION === "browser" ? viaEngine : viaNetwork)(path, { method, token, body, formData });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch {
      /* body wasn't JSON — keep statusText */
    }
    if (res.status === 401 && token) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null;
  return res.json();
}
