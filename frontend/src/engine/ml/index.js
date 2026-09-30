// Forecast orchestration: runs one model over a history and backtests it against held-out days.
import { gbdtForecast } from "./gbdt.js";
import { ForecastUnavailable, attentionForecast, lstmForecast } from "./nn.js";
import { seasonalForecast } from "./seasonal.js";

export { ForecastUnavailable };

/** API model ids → implementation. (Ids are kept stable; see the UI for the display names.) */
export const MODEL_IDS = ["prophet", "xgboost", "lstm", "tft"];

/** history: [{ date, units, promo, temp, holiday, event }] ascending. → { rows, mape? } */
export function runModel(model, history, horizon) {
  if (model === "prophet") return { rows: seasonalForecast(history, horizon) };
  if (model === "xgboost") return { rows: gbdtForecast(history, horizon) };
  if (model === "lstm") return lstmForecast(history, horizon);
  return attentionForecast(history, horizon);
}

/**
 * A genuine backtest: train on everything but the last `testDays`, predict those days and compare
 * with what actually sold. null ("not enough data") beats a made-up number when the history is too
 * short to hold out a fair test window.
 */
export function liveMape(model, history, testDays = 7) {
  if (history.length < testDays + 20) return null;
  const train = history.slice(0, -testDays);
  const test = history.slice(-testDays);
  let result;
  try {
    result = runModel(model, train, testDays);
  } catch (error) {
    if (error instanceof ForecastUnavailable) return null;
    throw error;
  }
  let total = 0;
  let count = 0;
  test.forEach((actual, i) => {
    const predicted = result.rows[i]?.yhat;
    if (predicted == null || actual.units === 0) return;
    total += Math.abs((actual.units - predicted) / actual.units);
    count += 1;
  });
  return count ? (total / count) * 100 : null;
}

/** Changes whenever any training input changes — training is seeded, so equal inputs give equal output. */
export function fingerprint(history) {
  let h = 2166136261;
  for (const r of history) {
    for (const v of [r.date, r.units, r.promo, r.temp, r.holiday, r.event]) {
      h ^= Math.round((v ?? 0) * 100) & 0xffffffff;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h;
}
