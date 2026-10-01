// Two neural forecasters trained live in the browser, on the small autodiff engine:
//   • an LSTM that predicts the next day and rolls forward (recurrent, iterative), and
//   • an attention model (a small Transformer encoder over the look-back window with a direct
//     multi-horizon head) that predicts every horizon day in one pass.
// The second is attention-based and multi-horizon like a Temporal Fusion Transformer, but it is the
// compact encoder-only form — no variable-selection or gating networks, no quantile loss.
import { DAY, createRng, pyWeekday } from "../util.js";
import * as ad from "./autodiff.js";

export const LOOKBACK = 14;
export const F = 7; // units, dow_sin, dow_cos, promo, holiday, event, temperature

export class ForecastUnavailable extends Error {}

const rawFeatures = (history) => history.map((h) => {
  const dow = pyWeekday(h.date);
  return [h.units, Math.sin((2 * Math.PI * dow) / 7), Math.cos((2 * Math.PI * dow) / 7), h.promo, h.holiday, h.event, h.temp ?? 0];
});

/** Per-feature mean/std from the rows the model is trained on (never from held-out days). */
function featureStats(raw) {
  return Array.from({ length: F }, (_, f) => {
    const col = raw.map((r) => r[f]);
    const mean = col.reduce((a, b) => a + b, 0) / col.length;
    const sd = Math.sqrt(col.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, col.length - 1));
    return { mean, std: sd || 1 };
  });
}

const normaliseRows = (raw, stats) => raw.map((r) => r.map((v, f) => (v - stats[f].mean) / stats[f].std));

/**
 * Splits a history into the part the model trains on and a held-out tail. Training on all but the
 * last `holdout` days, then scoring those days, makes the reported MAPE a genuine backtest; the
 * forecast itself still starts from the freshest window, so nothing newer is ignored.
 */
function prepare(history, minRows, holdout) {
  const canHoldOut = history.length >= minRows + holdout;
  const trainLen = canHoldOut ? history.length - holdout : history.length;
  const raw = rawFeatures(history);
  const stats = featureStats(raw.slice(0, trainLen));
  return { canHoldOut, trainLen, norm: normaliseRows(raw, stats), stats };
}

const std = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

/** MAPE (%) of predictions against what actually sold; null when there is nothing to compare. */
function mapeOf(pred, actual) {
  let total = 0, count = 0;
  for (let i = 0; i < Math.min(pred.length, actual.length); i++) if (actual[i] !== 0) { total += Math.abs((actual[i] - pred[i]) / actual[i]); count++; }
  return count ? (total / count) * 100 : null;
}

const rmse = (pred, actual) => Math.sqrt(pred.reduce((s, p, i) => s + (p - actual[i]) ** 2, 0) / Math.max(1, pred.length));

const uniform = (rng, limit) => () => rng.uniform(-limit, limit);

// ---- LSTM ---------------------------------------------------------------------------------

export function lstmParams(rng, hidden) {
  const k = 1 / Math.sqrt(hidden);
  return {
    W: ad.param(F + hidden, 4 * hidden, uniform(rng, k)),
    b: ad.param(1, 4 * hidden, uniform(rng, k)),
    Wh: ad.param(hidden, 1, uniform(rng, k)),
    bh: ad.param(1, 1, uniform(rng, k)),
  };
}

export function lstmForward(p, steps, n, hidden) {
  let h = ad.zeros(n, hidden);
  let c = ad.zeros(n, hidden);
  for (const x of steps) {
    const gates = ad.addBias(ad.matmul(ad.concatCols(x, h), p.W), p.b);
    const i = ad.sigmoid(ad.sliceCols(gates, 0, hidden));
    const f = ad.sigmoid(ad.sliceCols(gates, hidden, 2 * hidden));
    const g = ad.tanh(ad.sliceCols(gates, 2 * hidden, 3 * hidden));
    const o = ad.sigmoid(ad.sliceCols(gates, 3 * hidden, 4 * hidden));
    c = ad.add(ad.mul(f, c), ad.mul(i, g));
    h = ad.mul(o, ad.tanh(c));
  }
  return ad.addBias(ad.matmul(h, p.Wh), p.bh); // [n × 1]
}

export const stepTensors = (windows, n) =>
  Array.from({ length: LOOKBACK }, (_, t) => ad.constant(n, F, windows.flatMap((w) => w[t])));

export function lstmForecast(history, horizon, { epochs = 40, hidden = 16, holdout = 7 } = {}) {
  const minRows = LOOKBACK + 10;
  if (history.length < minRows) {
    throw new ForecastUnavailable(`LSTM needs at least ${minRows} days of sales history for this store/category — only ${history.length} available yet.`);
  }
  const { canHoldOut, trainLen, norm, stats } = prepare(history, minRows, holdout);
  const windows = [];
  const targets = [];
  for (let i = LOOKBACK; i < trainLen; i++) { windows.push(norm.slice(i - LOOKBACK, i)); targets.push(norm[i][0]); }
  const n = windows.length;

  const rng = createRng(42);
  const p = lstmParams(rng, hidden);
  const steps = stepTensors(windows, n);
  const opt = new ad.Adam(Object.values(p), { lr: 0.01 });
  for (let e = 0; e < epochs; e++) {
    opt.zeroGrad();
    ad.backward(ad.mse(lstmForward(p, steps, n, hidden), targets));
    opt.step();
  }

  const { mean, std: sd } = stats[0];
  const fitted = lstmForward(p, steps, n, hidden).data;
  const trainRmse = std(Array.from(fitted, (v, i) => v - targets[i])) * sd;

  // Roll forward from the window ending at `end`, feeding each prediction back in as the next day's value.
  const rollout = (end, count) => {
    let window = norm.slice(end - LOOKBACK, end).map((r) => [...r]);
    let dow = pyWeekday(history[end - 1].date);
    const preds = [];
    for (let step = 0; step < count; step++) {
      const next = lstmForward(p, stepTensors([window], 1), 1, hidden).data[0];
      preds.push(next * sd + mean);
      dow = (dow + 1) % 7;
      const row = [...window.at(-1)];
      row[0] = next;
      row[1] = (Math.sin((2 * Math.PI * dow) / 7) - stats[1].mean) / stats[1].std;
      row[2] = (Math.cos((2 * Math.PI * dow) / 7) - stats[2].mean) / stats[2].std;
      window = [...window.slice(1), row];
    }
    return preds;
  };

  return finish(history, horizon, rollout(history.length, horizon), {
    canHoldOut, trainRmse,
    heldOut: canHoldOut ? rollout(trainLen, holdout) : null,
    actual: history.slice(trainLen).map((h) => h.units),
    fitted: { pred: Array.from(fitted, (v) => v * sd + mean), actual: targets.map((v) => v * sd + mean) },
  });
}

/** Shared tail: MAPE (held-out when possible, else the training fit) and an ~80% band. */
function finish(history, horizon, preds, { canHoldOut, trainRmse, heldOut, actual, fitted }) {
  const mape = canHoldOut ? mapeOf(heldOut, actual) : mapeOf(fitted.pred, fitted.actual);
  const spread = canHoldOut ? Math.max(trainRmse, rmse(heldOut, actual)) : trainRmse;
  const band = spread * 1.28;
  const last = history.at(-1).date;
  return {
    mape,
    mapeKind: canHoldOut ? "backtest" : "training_fit",
    rows: preds.map((v, i) => ({ date: last + (i + 1) * DAY, yhat: Math.max(0, v), lower: Math.max(0, v - band), upper: v + band })),
  };
}

// ---- attention (encoder-only, multi-horizon) --------------------------------------------------

export function attentionParams(rng, d, ff, horizon) {
  const xavier = (fanIn, fanOut) => uniform(rng, Math.sqrt(6 / (fanIn + fanOut)));
  const lin = (i, o) => ad.param(i, o, xavier(i, o));
  const bias = (o) => ad.param(1, o, () => 0);
  return {
    Wp: lin(F, d), bp: bias(d),
    Wq: lin(d, d), bq: bias(d), Wk: lin(d, d), bk: bias(d), Wv: lin(d, d), bv: bias(d), Wo: lin(d, d), bo: bias(d),
    g1: ad.param(1, d, () => 1), be1: bias(d),
    W1: lin(d, ff), b1: bias(ff), W2: lin(ff, d), b2: bias(d),
    g2: ad.param(1, d, () => 1), be2: bias(d),
    Wh: lin(d, horizon), bh: bias(horizon),
  };
}

export function attentionForward(p, x, n, heads) {
  const tokens = ad.addBias(ad.matmul(x, p.Wp), p.bp);
  const q = ad.addBias(ad.matmul(tokens, p.Wq), p.bq);
  const k = ad.addBias(ad.matmul(tokens, p.Wk), p.bk);
  const v = ad.addBias(ad.matmul(tokens, p.Wv), p.bv);
  const attended = ad.addBias(ad.matmul(ad.attention(q, k, v, n, LOOKBACK, heads), p.Wo), p.bo);
  const h1 = ad.layerNorm(ad.add(tokens, attended), p.g1, p.be1);
  const ffn = ad.addBias(ad.matmul(ad.relu(ad.addBias(ad.matmul(h1, p.W1), p.b1)), p.W2), p.b2);
  const h2 = ad.layerNorm(ad.add(h1, ffn), p.g2, p.be2);
  const lastTokens = ad.gatherRows(h2, Array.from({ length: n }, (_, s) => s * LOOKBACK + LOOKBACK - 1));
  return ad.addBias(ad.matmul(lastTokens, p.Wh), p.bh); // [n × horizon]
}

export function attentionForecast(history, horizon, { epochs = 40, dModel = 16, heads = 2, ff = 32, holdout = 7 } = {}) {
  const minRows = LOOKBACK + horizon + 10;
  if (history.length < minRows) {
    throw new ForecastUnavailable(`TFT-style forecasting needs at least ${minRows} days of sales history for this store/category — only ${history.length} available yet.`);
  }
  const { canHoldOut, trainLen, norm, stats } = prepare(history, minRows, holdout);
  const windows = [];
  const targets = [];
  for (let i = LOOKBACK; i <= trainLen - horizon; i++) {
    windows.push(norm.slice(i - LOOKBACK, i));
    targets.push(...norm.slice(i, i + horizon).map((r) => r[0]));
  }
  const n = windows.length;
  if (n < 5) throw new ForecastUnavailable("Not enough history to form multi-horizon training windows yet for TFT-style forecasting.");

  const rng = createRng(42);
  const p = attentionParams(rng, dModel, ff, horizon);
  const x = ad.constant(n * LOOKBACK, F, windows.flat(2));
  const opt = new ad.Adam(Object.values(p), { lr: 0.01 });
  for (let e = 0; e < epochs; e++) {
    opt.zeroGrad();
    ad.backward(ad.mse(attentionForward(p, x, n, heads), targets));
    opt.step();
  }

  const { mean, std: sd } = stats[0];
  const fitted = attentionForward(p, x, n, heads).data;
  const trainRmse = std(Array.from(fitted, (v, i) => v - targets[i])) * sd;
  const predictFrom = (end) => Array.from(attentionForward(p, ad.constant(LOOKBACK, F, norm.slice(end - LOOKBACK, end).flat()), 1, heads).data, (v) => v * sd + mean);

  const actual = history.slice(trainLen).map((h) => h.units);
  return finish(history, horizon, predictFrom(history.length), {
    canHoldOut, trainRmse,
    heldOut: canHoldOut ? predictFrom(trainLen).slice(0, actual.length) : null,
    actual,
    fitted: { pred: Array.from(fitted, (v) => v * sd + mean), actual: targets.map((v) => v * sd + mean) },
  });
}
