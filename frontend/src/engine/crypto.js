// Password hashing (PBKDF2-SHA256) and HS256 JWTs on top of WebCrypto — no dependencies.
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64Url = (bytes) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s) => fromB64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));

export const PBKDF2_ITERATIONS = 150_000;

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** A fresh random salt unless one is given (only the build-time seed-hash script passes its own). */
export async function hashPassword(raw, iterations = PBKDF2_ITERATIONS, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const hash = await pbkdf2(raw, salt, iterations);
  return { alg: "pbkdf2-sha256", iterations, salt: toB64(salt), hash: toB64(hash) };
}

const UNKNOWN_ACCOUNT_SALT = new Uint8Array(16);

/** `record` may be null (accounts with no usable login); a miss costs the same time as a wrong password. */
export async function verifyPassword(raw, record) {
  if (!record) {
    await pbkdf2(raw, UNKNOWN_ACCOUNT_SALT, PBKDF2_ITERATIONS);
    return false;
  }
  const hash = await pbkdf2(raw, fromB64(record.salt), record.iterations);
  return timingSafeEqual(hash, fromB64(record.hash));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signJwt(payload, secret) {
  const head = toB64Url(enc.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = toB64Url(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${toB64Url(new Uint8Array(sig))}`;
}

/** Returns the payload, or null when the token is malformed, tampered with, or expired. */
export async function verifyJwt(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64Url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
    if (!ok) return null;
    const payload = JSON.parse(dec.decode(fromB64Url(parts[1])));
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export const randomSecret = (bytes = 32) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
