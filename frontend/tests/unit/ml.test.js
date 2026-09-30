import { beforeAll, describe, expect, it } from "vitest";
import * as ad from "../../src/engine/ml/autodiff.js";
import { fingerprint, liveMape, runModel } from "../../src/engine/ml/index.js";
import { F, ForecastUnavailable, LOOKBACK, attentionForward, attentionParams, lstmForward, lstmParams } from "../../src/engine/ml/nn.js";
import { DAY, createRng } from "../../src/engine/util.js";
import { boot } from "./helpers.js";

// ---- gradient checking ---------------------------------------------------------------------

/** Compares analytic gradients to central finite differences for every element of every param. */
function gradCheck(params, lossFn, { eps = 1e-5, tol = 1e-4 } = {}) {
  for (const p of params) p.grad = null;
  ad.backward(lossFn());
  const analytic = params.map((p) => Float64Array.from(p.grad ?? new Float64Array(p.size)));
  let worst = 0;
  params.forEach((p, k) => {
    for (let i = 0; i < p.size; i++) {
      const original = p.data[i];
      p.data[i] = original + eps;
      const up = lossFn().data[0];
      p.data[i] = original - eps;
      const down = lossFn().data[0];
      p.data[i] = original;
      const numeric = (up - down) / (2 * eps);
      const err = Math.abs(numeric - analytic[k][i]) / Math.max(1e-8, Math.abs(numeric) + Math.abs(analytic[k][i]));
      worst = Math.max(worst, err);
    }
  });
  expect(worst).toBeLessThan(tol);
}

const rand = (seed) => { const rng = createRng(seed); return () => rng.uniform(-1, 1); };
const target = (n, seed) => Float64Array.from({ length: n }, rand(seed));

describe("autodiff: every op's gradient matches finite differences", () => {
  it("matmul + addBias + tanh", () => {
    const w = ad.param(3, 4, rand(1)), b = ad.param(1, 4, rand(2));
    const x = ad.constant(5, 3, target(15, 3));
    gradCheck([w, b], () => ad.mse(ad.tanh(ad.addBias(ad.matmul(x, w), b)), target(20, 4)));
  });

  it("sigmoid, relu, mul and add", () => {
    const a = ad.param(4, 3, rand(5)), b = ad.param(4, 3, rand(6));
    gradCheck([a, b], () => ad.mse(ad.add(ad.mul(ad.sigmoid(a), ad.relu(b)), a), target(12, 7)));
  });

  it("sliceCols and concatCols", () => {
    const a = ad.param(3, 6, rand(8)), b = ad.param(3, 2, rand(9));
    gradCheck([a, b], () => ad.mse(ad.concatCols(ad.sliceCols(a, 1, 4), b), target(15, 10)));
  });

  it("gatherRows", () => {
    const a = ad.param(6, 3, rand(11));
    gradCheck([a], () => ad.mse(ad.gatherRows(a, [5, 0, 0, 2]), target(12, 12)));
  });

  it("layerNorm", () => {
    const a = ad.param(4, 5, rand(13)), g = ad.param(1, 5, rand(14)), be = ad.param(1, 5, rand(15));
    gradCheck([a, g, be], () => ad.mse(ad.layerNorm(a, g, be), target(20, 16)));
  });

  it("fused multi-head attention", () => {
    const n = 2, len = 3, heads = 2, d = 4;
    const q = ad.param(n * len, d, rand(17)), k = ad.param(n * len, d, rand(18)), v = ad.param(n * len, d, rand(19));
    gradCheck([q, k, v], () => ad.mse(ad.attention(q, k, v, n, len, heads), target(n * len * d, 20)));
  });

  it("the full LSTM", () => {
    const rng = createRng(21), hidden = 3, n = 2;
    const p = lstmParams(rng, hidden);
    const steps = Array.from({ length: LOOKBACK }, () => ad.constant(n, F, target(n * F, rng.int(1, 999))));
    gradCheck(Object.values(p), () => ad.mse(lstmForward(p, steps, n, hidden), target(n, 22)), { tol: 5e-4 });
  });

  it("the full attention model", () => {
    const rng = createRng(23), n = 2, horizon = 3;
    const p = attentionParams(rng, 4, 6, horizon);
    const x = ad.constant(n * LOOKBACK, F, target(n * LOOKBACK * F, 24));
    gradCheck(Object.values(p), () => ad.mse(attentionForward(p, x, n, 2), target(n * horizon, 25)), { tol: 5e-4 });
  });

  it("Adam drives a simple regression to its solution", () => {
    const w = ad.param(2, 1, () => 0), b = ad.param(1, 1, () => 0);
    const xs = Array.from({ length: 40 }, (_, i) => [i / 20 - 1, Math.sin(i)]);
    const x = ad.constant(40, 2, xs.flat());
    const y = Float64Array.from(xs, ([a, c]) => 2 * a - 3 * c + 0.5);
    const opt = new ad.Adam([w, b], { lr: 0.05 });
    let loss;
    for (let e = 0; e < 600; e++) { opt.zeroGrad(); loss = ad.mse(ad.addBias(ad.matmul(x, w), b), y); ad.backward(loss); opt.step(); }
    expect(loss.data[0]).toBeLessThan(1e-3);
    expect(w.data[0]).toBeCloseTo(2, 1);
    expect(w.data[1]).toBeCloseTo(-3, 1);
  });
});

// ---- the forecasters -----------------------------------------------------------------------

let t, history;
beforeAll(async () => {
  t = await boot();
  const rows = t.db.where("sales_records", (s) => s.store_id === t.hq.id && s.category === "Dairy & Chilled").sort((a, b) => a.date - b.date);
  history = rows.map((s) => ({ date: s.date, units: s.units_sold, promo: s.promo_flag ? 1 : 0, temp: s.temperature_c, holiday: 0, event: s.local_event_flag ? 1 : 0 }));
});

const plausible = (rows, horizon) => {
  expect(rows).toHaveLength(horizon);
  const base = history.slice(-28).reduce((s, h) => s + h.units, 0) / 28;
  rows.forEach((r, i) => {
    expect(Number.isFinite(r.yhat)).toBe(true);
    expect(r.yhat).toBeGreaterThan(base * 0.5);
    expect(r.yhat).toBeLessThan(base * 1.6);
    expect(r.date).toBe(history.at(-1).date + (i + 1) * DAY);
    if (r.lower != null) { expect(r.lower).toBeLessThanOrEqual(r.yhat); expect(r.upper).toBeGreaterThanOrEqual(r.yhat); }
  });
};

describe("forecasting models", () => {
  for (const [model, maxMape] of [["prophet", 20], ["xgboost", 25]]) {
    it(`${model}: plausible 7-day forecast and a real backtest`, () => {
      const { rows } = runModel(model, history, 7);
      plausible(rows, 7);
      const mape = liveMape(model, history);
      expect(mape).toBeGreaterThan(0);
      expect(mape).toBeLessThan(maxMape);
    });
  }

  for (const model of ["lstm", "tft"]) {
    it(`${model}: trains in the browser, fits the history and forecasts the horizon`, () => {
      const started = performance.now();
      const { rows, mape } = runModel(model, history, 7);
      const seconds = (performance.now() - started) / 1000;
      plausible(rows, 7);
      expect(mape).toBeGreaterThan(0);
      expect(mape).toBeLessThan(25);
      console.info(`${model}: trained in ${seconds.toFixed(2)}s, in-sample MAPE ${mape.toFixed(1)}%`);
      expect(seconds).toBeLessThan(30);
    });
  }

  it("captures the weekend uplift that is in the data", () => {
    const weekdayMean = history.filter((h) => ![0, 6].includes(new Date(h.date).getUTCDay())).reduce((s, h, _, a) => s + h.units / a.length, 0);
    const weekendMean = history.filter((h) => [0, 6].includes(new Date(h.date).getUTCDay())).reduce((s, h, _, a) => s + h.units / a.length, 0);
    expect(weekendMean).toBeGreaterThan(weekdayMean);
    for (const model of ["prophet", "xgboost"]) {
      const { rows } = runModel(model, history, 14);
      const isWeekend = (r) => [0, 6].includes(new Date(r.date).getUTCDay());
      const wk = rows.filter(isWeekend).reduce((s, r, _, a) => s + r.yhat / a.length, 0);
      const wd = rows.filter((r) => !isWeekend(r)).reduce((s, r, _, a) => s + r.yhat / a.length, 0);
      expect(wk).toBeGreaterThan(wd);
    }
  });

  it("is deterministic: the same history always gives the same forecast", () => {
    for (const model of ["prophet", "xgboost", "lstm"]) {
      expect(runModel(model, history, 7).rows).toEqual(runModel(model, history, 7).rows);
    }
  });

  it("refuses to fabricate a forecast from too little history", () => {
    expect(() => runModel("lstm", history.slice(-20), 7)).toThrow(ForecastUnavailable);
    expect(() => runModel("tft", history.slice(-30), 7)).toThrow(/needs at least 31 days/);
    expect(liveMape("prophet", history.slice(-20))).toBeNull();
  });

  it("fingerprints change when any training input changes", () => {
    const a = fingerprint(history);
    expect(fingerprint(history)).toBe(a);
    const edited = history.map((h, i) => (i === 10 ? { ...h, units: h.units + 1 } : h));
    expect(fingerprint(edited)).not.toBe(a);
  });
});

describe("forecast API", () => {
  it("returns actuals then a forecast, with the recommendation and a real MAPE", async () => {
    const token = await t.as("manager");
    const res = await t.call("GET", `/forecast/${encodeURIComponent("Dairy & Chilled")}?store_id=${t.hq.id}&model=prophet&horizon_days=7`, { token });
    expect(res.status).toBe(200);
    const { points, mape, recommended_po_quantity, recommendation, confidence } = res.body;
    expect(points.filter((p) => p.kind === "actual")).toHaveLength(14);
    expect(points.filter((p) => p.kind === "forecast")).toHaveLength(7);
    expect(points[13].predicted).toBe(points[13].actual); // the lines join where the actuals end
    expect(points.at(-1)).toMatchObject({ actual: null, band_low: expect.any(Number), band_high: expect.any(Number) });
    expect(mape).toBeGreaterThan(0);
    expect(confidence).toBeCloseTo(1 - mape / 100, 2);
    expect(recommended_po_quantity).toBeGreaterThan(0);
    expect(recommendation).toMatch(/^Expected demand is [\d,]+ units over the next 7 days/);
  });

  it("serves a repeat request from cache and reflects new data when sales change", async () => {
    const token = await t.as("manager");
    const url = `/forecast/Produce?store_id=${t.hq.id}&model=xgboost&horizon_days=5`;
    const first = await t.call("GET", url, { token });
    const started = performance.now();
    const again = await t.call("GET", url, { token });
    expect(performance.now() - started).toBeLessThan(50);
    expect(again.body).toEqual(first.body);
    const last = t.db.where("sales_records", (s) => s.store_id === t.hq.id && s.category === "Produce").at(-1);
    last.units_sold += 400;
    const changed = await t.call("GET", url, { token });
    expect(changed.body.points.filter((p) => p.kind === "actual").at(-1).actual).toBe(last.units_sold);
    expect(changed.body.points.at(-1).predicted).not.toBe(first.body.points.at(-1).predicted);
  });

  it("validates the model, the horizon and the data", async () => {
    const token = await t.as("manager");
    const bad = await t.call("GET", `/forecast/Produce?store_id=${t.hq.id}&model=arima`, { token });
    expect(bad).toMatchObject({ status: 422, body: { detail: "model must be one of ['lstm', 'prophet', 'tft', 'xgboost']" } });
    expect((await t.call("GET", `/forecast/Produce?store_id=${t.hq.id}&horizon_days=0`, { token })).status).toBe(422);
    expect(await t.call("GET", `/forecast/Nonexistent?store_id=${t.hq.id}`, { token })).toMatchObject({ status: 404, body: { detail: "No sales history for this store/category yet" } });
    expect((await t.call("GET", "/forecast/Produce", { token })).status).toBe(422);
    expect((await t.call("GET", `/forecast/Produce?store_id=${t.hq.id}`, { token: await t.as("customer") })).status).toBe(403);
  });

  it("answers 501 for a neural model when history is too short", async () => {
    const token = await t.as("manager");
    const riverside = t.byName("stores", "Riverside Mall");
    const keep = t.db.where("sales_records", (s) => s.store_id === riverside.id && s.category === "Bakery").sort((a, b) => b.date - a.date).slice(0, 15).map((s) => s.id);
    for (const s of [...t.db.all("sales_records")]) if (s.store_id === riverside.id && s.category === "Bakery" && !keep.includes(s.id)) t.db.remove("sales_records", s.id);
    const res = await t.call("GET", `/forecast/Bakery?store_id=${riverside.id}&model=lstm`, { token });
    expect(res).toMatchObject({ status: 501, body: { detail: expect.stringMatching(/LSTM needs at least 24 days/) } });
    expect((await t.call("GET", `/forecast/Bakery?store_id=${riverside.id}&model=prophet`, { token })).status).toBe(200);
  });
});
