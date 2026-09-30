// Gradient-boosted regression trees, XGBoost-style: second-order gain with L2 regularisation,
// depth-limited greedy splits, row and column subsampling, shrinkage. Trained on lagged demand
// plus calendar, promotion and weather features; multi-day forecasts roll forward one day at a time.
import { DAY, createRng, pyWeekday } from "../util.js";

const PARAMS = { trees: 300, depth: 4, eta: 0.05, subsample: 0.85, colsample: 0.85, lambda: 1, gamma: 0, minChildWeight: 1 };

function buildTree(X, rows, grad, cols, depth) {
  let G = 0;
  for (const r of rows) G += grad[r];
  const H = rows.length; // squared-error loss: every hessian is 1
  const leaf = { value: -G / (H + PARAMS.lambda) };
  if (depth >= PARAMS.depth || H < 2 * PARAMS.minChildWeight) return leaf;

  let best = null;
  const parentScore = (G * G) / (H + PARAMS.lambda);
  for (const c of cols) {
    const order = [...rows].sort((a, b) => X[a][c] - X[b][c]);
    let GL = 0;
    for (let i = 0; i < order.length - 1; i++) {
      GL += grad[order[i]];
      const HL = i + 1;
      const HR = H - HL;
      if (X[order[i]][c] === X[order[i + 1]][c]) continue;
      if (HL < PARAMS.minChildWeight || HR < PARAMS.minChildWeight) continue;
      const GR = G - GL;
      const gain = 0.5 * ((GL * GL) / (HL + PARAMS.lambda) + (GR * GR) / (HR + PARAMS.lambda) - parentScore) - PARAMS.gamma;
      if (!best || gain > best.gain) best = { gain, col: c, threshold: (X[order[i]][c] + X[order[i + 1]][c]) / 2 };
    }
  }
  if (!best || best.gain <= 1e-9) return leaf;

  const left = rows.filter((r) => X[r][best.col] <= best.threshold);
  const right = rows.filter((r) => X[r][best.col] > best.threshold);
  if (!left.length || !right.length) return leaf;
  return {
    col: best.col, threshold: best.threshold,
    left: buildTree(X, left, grad, cols, depth + 1),
    right: buildTree(X, right, grad, cols, depth + 1),
  };
}

const predictTree = (tree, x) => {
  let node = tree;
  while (node.left) node = x[node.col] <= node.threshold ? node.left : node.right;
  return node.value;
};

export function trainGbdt(X, y, seed = 42) {
  const rng = createRng(seed);
  const n = y.length;
  const nCols = X[0].length;
  const base = y.reduce((a, b) => a + b, 0) / n;
  const pred = new Float64Array(n).fill(base);
  const trees = [];
  for (let m = 0; m < PARAMS.trees; m++) {
    const grad = Float64Array.from(pred, (p, i) => p - y[i]);
    const rows = [];
    for (let i = 0; i < n; i++) if (rng.random() < PARAMS.subsample) rows.push(i);
    const cols = [];
    for (let c = 0; c < nCols; c++) if (rng.random() < PARAMS.colsample) cols.push(c);
    if (rows.length < 2 || !cols.length) continue;
    const tree = buildTree(X, rows, grad, cols, 0);
    trees.push(tree);
    for (let i = 0; i < n; i++) pred[i] += PARAMS.eta * predictTree(tree, X[i]);
  }
  return { base, trees };
}

export const predictGbdt = (model, x) => model.trees.reduce((s, t) => s + PARAMS.eta * predictTree(t, x), model.base);

/** Features for target day i, using only what is known the day before (no leakage of the target). */
function featuresFor(date, units, i, promo, holiday, event, temp) {
  const dow = pyWeekday(date);
  const window = units.slice(Math.max(0, i - 7), i);
  return [
    dow, new Date(date).getUTCDate(), dow >= 5 ? 1 : 0, holiday, event, promo, temp,
    units[i - 1], units[i - 7] ?? units[i - 1], window.reduce((a, b) => a + b, 0) / window.length,
  ];
}

/** history: [{ date, units, promo, temp, holiday, event }] ascending. Returns [{ date, yhat }]. */
export function gbdtForecast(history, horizon) {
  const units = history.map((h) => h.units);
  const X = [];
  const y = [];
  for (let i = 7; i < history.length; i++) {
    const h = history[i];
    X.push(featuresFor(h.date, units, i, h.promo, h.holiday, h.event, h.temp));
    y.push(h.units);
  }
  const model = trainGbdt(X, y);

  const recentTemp = history.slice(-7).reduce((s, h) => s + h.temp, 0) / Math.min(7, history.length);
  const series = [...units];
  const out = [];
  for (let step = 1; step <= horizon; step++) {
    const date = history[history.length - 1].date + step * DAY;
    const yhat = Math.max(0, predictGbdt(model, featuresFor(date, series, series.length, 0, 0, 0, recentTemp)));
    series.push(yhat);
    out.push({ date, yhat });
  }
  return out;
}
