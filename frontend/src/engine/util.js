// Shared helpers for the in-browser API engine (the "browser edition" backend).

export class HttpError extends Error {
  constructor(status, detail, headers = {}) {
    super(typeof detail === "string" ? detail : "Request failed");
    this.status = status;
    this.detail = detail;
    this.headers = headers;
  }
}

/** Handlers return plain data (200) or respond(status, body) for anything else (201, 204, …). */
export const respond = (status, body = null) => ({ __response: true, status, body });

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

export const startOfUtcDay = (ms) => Math.floor(ms / DAY) * DAY;
export const iso = (ms) => (ms == null ? null : new Date(ms).toISOString());

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const weekdayShort = (ms) => WEEKDAYS[new Date(ms).getUTCDay()];
export const monthDay = (ms) => { const d = new Date(ms); return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")}`; };
/** Python's date.weekday(): Monday = 0 … Sunday = 6. */
export const pyWeekday = (ms) => (new Date(ms).getUTCDay() + 6) % 7;
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Python's round(): correctly rounded on the exact binary value (so 2.675 → 2.67), with genuine
 * ties going to the even neighbour (round(2.5) === 2). Multiplying first would invent false ties.
 */
export function pyRound(x, digits = 0) {
  if (!Number.isFinite(x)) return x;
  const exact = Math.abs(x).toFixed(Math.min(100, digits + 30));
  const tail = exact.slice(exact.indexOf(".") + 1 + digits);
  if (!/^50*$/.test(tail)) return Number(x.toFixed(digits));
  const scaled = Math.abs(x) * 10 ** digits; // a genuine tie is exactly representable, so this is exact
  const n = Math.floor(scaled);
  return (Math.sign(x) * (n % 2 === 0 ? n : n + 1)) / 10 ** digits;
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const sum = (arr, pick = (x) => x) => arr.reduce((s, x) => s + pick(x), 0);
export const mean = (arr) => (arr.length ? sum(arr) / arr.length : 0);

export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Deterministic PRNG so a fresh workspace is reproducible, and model training is seeded. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed) {
  const next = mulberry32(seed);
  return {
    random: next,
    uniform: (a, b) => a + (b - a) * next(),
    /** inclusive on both ends, like Python's random.randint */
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    gauss(mu, sigma) {
      let u = 0;
      while (u === 0) u = next();
      const v = next();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    choice: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

/** Case-insensitive "contains", the way SQL `ILIKE '%term%'` is used in the API. */
export const ilike = (haystack, term) => String(haystack ?? "").toLowerCase().includes(String(term).toLowerCase());

/** Random URL-safe token, like Python's secrets.token_urlsafe(nbytes). */
export function tokenUrlsafe(nbytes = 9) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(nbytes));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Minimal RFC-4180 CSV reader → array of header-keyed row objects (mirrors csv.DictReader). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ""));
  if (!nonEmpty.length) return { fieldnames: null, records: [] };
  const [header, ...body] = nonEmpty;
  const records = body.map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ""])));
  return { fieldnames: header, records };
}
