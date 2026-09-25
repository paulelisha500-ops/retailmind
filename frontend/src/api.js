const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8002";

export const UNAUTHORIZED_EVENT = "rm:unauthorized";

export class ApiError extends Error {
  constructor(status, detail) {
    super(formatDetail(detail));
    this.status = status;
  }
}

// FastAPI sends a string for handled errors but an array of {loc, msg} for 422 validation errors.
function formatDetail(detail) {
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc.filter((p) => p !== "body").join(" › ") : "";
        const msg = String(d.msg || "is invalid").replace(/^Value error, /, "");
        return field ? `${field}: ${msg}` : msg;
      })
      .join("; ");
  }
  return "Request failed";
}

export async function apiFetch(path, { method = "GET", token, body, formData } = {}) {
  const headers = {};
  if (token) headers.Authorization = "Bearer " + token;
  // FormData sets its own multipart Content-Type (with boundary) — never set it manually.
  if (body !== undefined && !formData) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: formData || (body !== undefined ? JSON.stringify(body) : undefined),
    });
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
