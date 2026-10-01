// The business assistant: a set of plain agents that each query one domain of live store data
// and compose an answer from real numbers. No language model is involved, so every sentence
// is traceable to a record; the router just picks the agent by keyword.
import { DAY } from "../util.js";
import { f, parseBody } from "../validate.js";

const CATEGORY_ALIASES = [
  ["dairy", "Dairy & Chilled"], ["chilled", "Dairy & Chilled"],
  ["produce", "Produce"], ["vegetable", "Produce"], ["fruit", "Produce"],
  ["frozen", "Frozen"],
  ["bakery", "Bakery"], ["bread", "Bakery"],
  ["meat", "Meat & Seafood"], ["seafood", "Meat & Seafood"],
];

const AskRequest = { question: f.str(), store_id: f.str() };
const reply = (agent, tone, text) => ({ agent, tone, text });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

function qualityAgent(ctx, storeId) {
  const { db, now } = ctx;
  const cutoff = now + 5 * DAY;
  const expiring = db
    .where("batches", (b) => b.store_id === storeId && b.status === "active" && b.expires_at <= cutoff)
    .sort((a, b) => a.expires_at - b.expires_at)
    .slice(0, 3);
  const openQuality = db.where("alerts", (a) => a.store_id === storeId && a.kind === "quality" && a.status !== "resolved");
  if (!expiring.length && !openQuality.length) {
    return reply("Quality Agent", "green", "Nothing needs attention right now — no batches expiring in the next 5 days and no open quality flags.");
  }
  const parts = [];
  if (expiring.length) {
    const lines = expiring.map((b) => `${db.get("products", b.product_id).name} (${b.lot_number}) in ${b.aisle_location || "store"} — ${Math.floor((b.expires_at - now) / DAY)}d left`);
    parts.push(`Expiring soonest: ${lines.join("; ")}.`);
  }
  if (openQuality.length) parts.push(`${openQuality.length} open quality flag(s): ${openQuality.slice(0, 2).map((a) => a.message).join("; ")}.`);
  return reply("Quality Agent", "amber", parts.join(" "));
}

function procurementAgent(ctx) {
  const suppliers = [...ctx.db.all("suppliers")].sort((a, b) => b.performance_score - a.performance_score);
  if (!suppliers.length) return reply("Procurement Agent", "neutral", "No suppliers on file yet.");
  const best = suppliers[0];
  const worst = suppliers.at(-1);
  let text = `${best.name} leads at a ${best.performance_score} score with ${Math.round(best.on_time_pct)}% on-time delivery.`;
  if (worst.id !== best.id) text += ` ${worst.name} is the weak link — ${worst.performance_score} score, ${worst.late_deliveries_30d} late deliveries in the last 30 days.`;
  const renewing = suppliers.filter((s) => s.contract_end).sort((a, b) => a.contract_end - b.contract_end);
  if (renewing.length) {
    const days = Math.floor((renewing[0].contract_end - ctx.now) / DAY);
    if (days <= 30) text += ` Also worth a look: ${renewing[0].name}'s contract renews in ${days} days.`;
  }
  return reply("Procurement Agent", "blue", text);
}

function forecastAgent(ctx, storeId, question) {
  const lower = question.toLowerCase();
  const category = CATEGORY_ALIASES.find(([alias]) => lower.includes(alias))?.[1] ?? null;
  const rows = ctx.db.where("sales_records", (s) => s.store_id === storeId && (!category || s.category === category));
  const recentCutoff = ctx.now - 7 * DAY;
  const priorCutoff = ctx.now - 14 * DAY;
  const recent = rows.filter((s) => s.date >= recentCutoff).map((s) => s.units_sold);
  const prior = rows.filter((s) => s.date >= priorCutoff && s.date < recentCutoff).map((s) => s.units_sold);
  const label = category ?? "overall demand";
  if (!recent.length || !prior.length) return reply("Forecast Agent", "neutral", `Not enough sales history yet to compare trends for ${label}.`);
  const recentAvg = mean(recent);
  const priorAvg = mean(prior);
  const pct = priorAvg ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
  return reply(
    "Forecast Agent", pct >= 0 ? "green" : "amber",
    `${cap(label)} is trending ${pct >= 0 ? "up" : "down"} about ${Math.round(Math.abs(pct))}% this week vs last week (${Math.round(recentAvg)} vs ${Math.round(priorAvg)} units/day on average), based on this store's sales records.`,
  );
}

function lossPreventionAgent(ctx, storeId) {
  const open = ctx.db.where("alerts", (a) => a.store_id === storeId && a.kind === "theft" && a.status !== "resolved");
  if (!open.length) return reply("Loss Prevention Agent", "green", "No open security flags right now.");
  const lines = open.map((a) => `${a.location}, ${a.message.toLowerCase()} (${Math.round(a.confidence)}% confidence)`);
  return reply("Loss Prevention Agent", "red", `${open.length} open flag(s): ${lines.join("; ")}. Nothing here is auto-actioned — each needs a human review.`);
}

function inventoryAgent(ctx, storeId) {
  const { db } = ctx;
  const urgent = db
    .where("batches", (b) => b.store_id === storeId && b.status === "active")
    .sort((a, b) => a.expires_at - b.expires_at)
    .slice(0, 3);
  const stockAlerts = db
    .where("alerts", (a) => a.store_id === storeId && a.kind === "stock" && a.status !== "resolved")
    .sort((a, b) => b.created_at - a.created_at);
  if (!urgent.length && !stockAlerts.length) return reply("Inventory Agent", "green", "No open stock issues right now.");
  const parts = [];
  if (stockAlerts.length) parts.push(`Priority order by open alerts: ${stockAlerts.map((a) => a.location).join("; ")}.`);
  if (urgent.length) parts.push(`Closest to expiry: ${urgent.map((b) => db.get("products", b.product_id).name).join(", ")}.`);
  return reply("Inventory Agent", "amber", parts.join(" "));
}

const AGENT_ROUTES = [
  [["expir", "attention", "freshness", "quality"], (ctx, sid) => qualityAgent(ctx, sid)],
  [["supplier", "perform", "best", "worst"], (ctx) => procurementAgent(ctx)],
  [["dairy", "produce", "frozen", "bakery", "meat", "decreas", "declin", "drop", "demand", "sales"], (ctx, sid, q) => forecastAgent(ctx, sid, q)],
  [["theft", "security", "concern", "safe", "loss"], (ctx, sid) => lossPreventionAgent(ctx, sid)],
  [["restock", "first", "priorit", "stock"], (ctx, sid) => inventoryAgent(ctx, sid)],
];

export function register(r) {
  r.post("/assistant/ask", async (ctx) => {
    await ctx.requireEmployee();
    const payload = parseBody(AskRequest, ctx.body);
    const lower = payload.question.toLowerCase();
    for (const [keywords, handler] of AGENT_ROUTES) {
      if (keywords.some((k) => lower.includes(k))) return handler(ctx, payload.store_id, payload.question);
    }
    return reply(
      "RetailMind Assistant", "neutral",
      "I can help with what's expiring, supplier performance, demand trends, today's security flags, or restock priority — try asking about one of those, or a specific category or supplier by name.",
    );
  });
}
