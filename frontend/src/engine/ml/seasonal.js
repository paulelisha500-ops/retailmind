// Additive seasonal-trend forecaster (the Prophet family of model): a piecewise-linear trend with
// changepoints, weekly seasonality as Fourier terms and a promotion regressor, fitted by ridge
// regression. Prediction intervals come from the residual spread and the leverage of each future day.
import { DAY } from "../util.js";

const FOURIER_ORDER = 3;
const Z90 = 1.645;

/** Cholesky factorisation of a symmetric positive-definite matrix (lower triangle, row-major). */
function cholesky(a, p) {
  const l = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i * p + j];
      for (let k = 0; k < j; k++) s -= l[i * p + k] * l[j * p + k];
      l[i * p + j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / l[j * p + j];
    }
  }
  return l;
}

function choleskySolve(l, p, b) {
  const z = new Float64Array(p);
  for (let i = 0; i < p; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i * p + k] * z[k];
    z[i] = s / l[i * p + i];
  }
  const x = new Float64Array(p);
  for (let i = p - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k < p; k++) s -= l[k * p + i] * x[k];
    x[i] = s / l[i * p + i];
  }
  return x;
}

function design(dayNumbers, t0, span, changepoints, promo) {
  return dayNumbers.map((day, i) => {
    const ts = (day - t0) / span;
    const row = [1, ts];
    for (const cp of changepoints) row.push(Math.max(0, ts - cp));
    for (let k = 1; k <= FOURIER_ORDER; k++) {
      row.push(Math.sin((2 * Math.PI * k * day) / 7), Math.cos((2 * Math.PI * k * day) / 7));
    }
    row.push(promo[i]);
    return row;
  });
}

/**
 * history: [{ date(ms), units, promo }] ascending, one row per day.
 * Returns [{ date, yhat, lower, upper }] for the next `horizon` days.
 */
export function seasonalForecast(history, horizon) {
  const n = history.length;
  const days = history.map((h) => Math.floor(h.date / DAY));
  const t0 = days[0];
  const span = Math.max(1, days[n - 1] - t0);

  const y = history.map((h) => h.units);
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const yStd = Math.sqrt(y.reduce((a, b) => a + (b - yMean) ** 2, 0) / Math.max(1, n - 1)) || 1;
  const yz = y.map((v) => (v - yMean) / yStd);

  const cpCount = Math.min(8, Math.max(0, Math.floor(n / 8)));
  const changepoints = Array.from({ length: cpCount }, (_, k) => 0.05 + (0.75 * k) / Math.max(1, cpCount - 1));
  const X = design(days, t0, span, changepoints, history.map((h) => h.promo));
  const p = X[0].length;

  // Ridge penalties: trend and intercept are free; changepoint deltas, seasonality and the
  // promotion effect are shrunk so a short, noisy history can't be over-fitted.
  const penalty = new Float64Array(p);
  for (let j = 2; j < 2 + cpCount; j++) penalty[j] = 1.0;
  for (let j = 2 + cpCount; j < p - 1; j++) penalty[j] = 0.1;
  penalty[p - 1] = 0.1;

  const A = new Float64Array(p * p);
  const b = new Float64Array(p);
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < p; i++) {
      b[i] += X[r][i] * yz[r];
      for (let j = 0; j <= i; j++) A[i * p + j] += X[r][i] * X[r][j];
    }
  }
  for (let i = 0; i < p; i++) {
    A[i * p + i] += penalty[i] + 1e-9;
    for (let j = 0; j < i; j++) A[j * p + i] = A[i * p + j];
  }
  const L = cholesky(A, p);
  const beta = choleskySolve(L, p, b);

  let sse = 0;
  for (let r = 0; r < n; r++) {
    let fit = 0;
    for (let i = 0; i < p; i++) fit += X[r][i] * beta[i];
    sse += (yz[r] - fit) ** 2;
  }
  const sigma = Math.sqrt(sse / Math.max(1, n - p * 0.6));

  const lastDay = days[n - 1];
  const futureDays = Array.from({ length: horizon }, (_, h) => lastDay + h + 1);
  const Xf = design(futureDays, t0, span, changepoints, new Array(horizon).fill(0)); // no promotion assumed ahead
  return Xf.map((x, h) => {
    let yhatZ = 0;
    for (let i = 0; i < p; i++) yhatZ += x[i] * beta[i];
    const v = choleskySolve(L, p, x);
    let leverage = 0;
    for (let i = 0; i < p; i++) leverage += x[i] * v[i];
    const se = sigma * Math.sqrt(1 + leverage) * yStd;
    const yhat = yhatZ * yStd + yMean;
    return {
      date: (lastDay + h + 1) * DAY,
      yhat: Math.max(0, yhat),
      lower: Math.max(0, yhat - Z90 * se),
      upper: Math.max(0, yhat + Z90 * se),
    };
  });
}
