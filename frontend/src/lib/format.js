// Small formatting helpers shared by the screens.

export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) : "—";

export const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—");

export const daysUntil = (iso) => (iso ? Math.round((new Date(iso) - Date.now()) / 86_400_000) : null);

export const aed = (n, digits = 2) => `AED ${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const loyaltyTier = (points) => (points >= 1000 ? "Gold tier" : points >= 400 ? "Silver tier" : "Bronze tier");

export const firstName = (name) => (name ?? "").split(" ")[0];

/** Outreach statuses as they read to a person. */
export const outreachLabel = { logged: "Logged · not sent", sent: "Sent", failed: "Failed" };
