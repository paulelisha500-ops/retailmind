// Demand forecasting: every model trains live against the store's own sales history, and a repeat
// request for unchanged data is served from a cache (safe, because training is seeded).
import { DAY, HttpError, clamp, iso, monthDay, pyRound, startOfUtcDay } from "../util.js";
import { f, parseQuery } from "../validate.js";
import { MODEL_IDS, fingerprint, liveMape } from "../ml/index.js";

const HISTORY_DAYS = 90;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 128;
const CONTEXT_DAYS = 14; // recent actuals shown ahead of the forecast

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function register(r) {
  r.get("/forecast/:category", async (ctx) => {
    await ctx.requireEmployee();
    const { store_id, model, horizon_days } = parseQuery({
      store_id: f.str(), model: f.str({ default: "tft" }), horizon_days: f.int({ default: 7, ge: 1, le: 30 }),
    }, ctx.query);
    if (!MODEL_IDS.includes(model)) throw new HttpError(422, `model must be one of ${JSON.stringify([...MODEL_IDS].sort()).replace(/"/g, "'").replace(/,/g, ", ")}`);

    const category = ctx.params.category;
    const since = startOfUtcDay(ctx.now) - HISTORY_DAYS * DAY;
    const history = ctx.db
      .where("sales_records", (s) => s.store_id === store_id && s.category === category && s.date >= since)
      .sort((a, b) => a.date - b.date)
      .map((s) => ({ date: s.date, units: s.units_sold, promo: s.promo_flag ? 1 : 0, temp: s.temperature_c ?? 0, holiday: s.is_holiday ? 1 : 0, event: s.local_event_flag ? 1 : 0 }));
    if (!history.length) throw new HttpError(404, "No sales history for this store/category yet");

    const key = [store_id, category, model, horizon_days, fingerprint(history)].join("|");
    const hit = ctx.rt.forecastCache.get(key);
    if (hit && ctx.now - hit.at < CACHE_TTL_MS) return hit.response;

    let result;
    try {
      result = await ctx.rt.ml.run(model, history, horizon_days);
    } catch (error) {
      if (error?.name === "ForecastUnavailable" || error?.constructor?.name === "ForecastUnavailable") throw new HttpError(501, error.message);
      throw error;
    }

    // Every model reports a held-out backtest: the neural ones score the last week as part of their single
    // training pass; the two fast models simply retrain on all but the last week.
    const mape = model === "lstm" || model === "tft" ? result.mape : liveMape(model, history);
    const mapeKind = model === "lstm" || model === "tft" ? result.mapeKind : "backtest";

    const actual = history.slice(-CONTEXT_DAYS).map((h, i, tail) => ({
      label: monthDay(h.date), date: iso(h.date), kind: "actual", actual: h.units,
      predicted: i === tail.length - 1 ? h.units : null, band_low: null, band_high: null, // the forecast line starts where the actuals end
    }));
    const forecast = result.rows.map((row) => ({
      label: monthDay(row.date), date: iso(row.date), kind: "forecast", actual: null, predicted: pyRound(row.yhat, 1),
      band_low: row.lower == null ? null : pyRound(row.lower, 1), band_high: row.upper == null ? null : pyRound(row.upper, 1),
    }));

    const expected = result.rows.reduce((s, row) => s + row.yhat, 0);
    const recentAvg = mean(history.slice(-7).map((h) => h.units));
    const response = {
      category, model, mape: mape == null ? null : pyRound(mape, 1), mape_kind: mape == null ? null : mapeKind, points: [...actual, ...forecast],
      recommendation: `Expected demand is ${Math.round(expected).toLocaleString("en-US")} units over the next ${horizon_days} days (${Math.round(expected / horizon_days)}/day), against ${Math.round(recentAvg)}/day over the past week.`,
      recommended_po_quantity: Math.ceil(expected * 1.1), // +10% safety stock
      confidence: mape == null ? null : pyRound(clamp(1 - mape / 100, 0, 1), 2),
    };

    if (ctx.rt.forecastCache.size >= CACHE_MAX) {
      const oldest = [...ctx.rt.forecastCache.entries()].sort(([, a], [, b]) => a.at - b.at)[0][0];
      ctx.rt.forecastCache.delete(oldest);
    }
    ctx.rt.forecastCache.set(key, { at: ctx.now, response });
    return response;
  });
}
