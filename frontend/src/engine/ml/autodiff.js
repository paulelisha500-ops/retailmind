// A small reverse-mode autodiff over 2-D tensors (row-major Float64Array) — just enough ops to
// train the LSTM and the attention forecaster in the browser. Every op records how to push
// gradients back to its inputs; `backward(loss)` walks the graph once in reverse.

export class Tensor {
  constructor(rows, cols, data = new Float64Array(rows * cols)) {
    this.rows = rows;
    this.cols = cols;
    this.data = data;
    this.grad = null;
    this.parents = [];
    this.backwardFn = null;
  }

  get size() {
    return this.rows * this.cols;
  }

  ensureGrad() {
    this.grad ??= new Float64Array(this.size);
    return this.grad;
  }
}

const node = (rows, cols, parents, backwardFn) => {
  const t = new Tensor(rows, cols);
  t.parents = parents;
  t.backwardFn = backwardFn;
  return t;
};

export const constant = (rows, cols, data) => new Tensor(rows, cols, Float64Array.from(data));
export const zeros = (rows, cols) => new Tensor(rows, cols);

/** A trainable parameter initialised from `init()`. */
export function param(rows, cols, init) {
  const t = new Tensor(rows, cols);
  for (let i = 0; i < t.size; i++) t.data[i] = init();
  t.trainable = true;
  return t;
}

// ---- ops -----------------------------------------------------------------------------------

export function matmul(a, b) {
  const n = a.rows, k = a.cols, m = b.cols;
  const A = a.data, B = b.data;
  const out = node(n, m, [a, b], () => {
    const G = out.grad;
    const GA = a.ensureGrad(), GB = b.ensureGrad();
    for (let i = 0; i < n; i++) {
      const iA = i * k, iC = i * m;
      for (let p = 0; p < k; p++) {
        const aip = A[iA + p], pB = p * m;
        let acc = 0;
        for (let j = 0; j < m; j++) {
          const g = G[iC + j];
          acc += g * B[pB + j];
          GB[pB + j] += aip * g;
        }
        GA[iA + p] += acc;
      }
    }
  });
  const C = out.data;
  for (let i = 0; i < n; i++) {
    const iA = i * k, iC = i * m;
    for (let p = 0; p < k; p++) {
      const aip = A[iA + p];
      if (aip === 0) continue;
      const pB = p * m;
      for (let j = 0; j < m; j++) C[iC + j] += aip * B[pB + j];
    }
  }
  return out;
}

/** a + b where b is a single row broadcast down every row of a. */
export function addBias(a, bias) {
  const { rows, cols } = a;
  const out = node(rows, cols, [a, bias], () => {
    const g = out.grad;
    const ga = a.ensureGrad(), gb = bias.ensureGrad();
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { ga[i * cols + j] += g[i * cols + j]; gb[j] += g[i * cols + j]; }
  });
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out.data[i * cols + j] = a.data[i * cols + j] + bias.data[j];
  return out;
}

export function add(a, b) {
  const size = a.size;
  const out = node(a.rows, a.cols, [a, b], () => {
    const ga = a.ensureGrad(), gb = b.ensureGrad(), g = out.grad;
    for (let i = 0; i < size; i++) { ga[i] += g[i]; gb[i] += g[i]; }
  });
  const o = out.data, x = a.data, y = b.data;
  for (let i = 0; i < size; i++) o[i] = x[i] + y[i];
  return out;
}

export function mul(a, b) {
  const size = a.size;
  const x = a.data, y = b.data;
  const out = node(a.rows, a.cols, [a, b], () => {
    const ga = a.ensureGrad(), gb = b.ensureGrad(), g = out.grad;
    for (let i = 0; i < size; i++) { ga[i] += g[i] * y[i]; gb[i] += g[i] * x[i]; }
  });
  const o = out.data;
  for (let i = 0; i < size; i++) o[i] = x[i] * y[i];
  return out;
}

const unary = (a, fwd, dfdy) => {
  const size = a.size;
  const x = a.data;
  const out = node(a.rows, a.cols, [a], () => {
    const ga = a.ensureGrad(), g = out.grad, y = out.data;
    for (let i = 0; i < size; i++) ga[i] += g[i] * dfdy(y[i], x[i]);
  });
  const o = out.data;
  for (let i = 0; i < size; i++) o[i] = fwd(x[i]);
  return out;
};

export const sigmoid = (a) => unary(a, (x) => 1 / (1 + Math.exp(-x)), (y) => y * (1 - y));
export const tanh = (a) => unary(a, Math.tanh, (y) => 1 - y * y);
export const relu = (a) => unary(a, (x) => (x > 0 ? x : 0), (_y, x) => (x > 0 ? 1 : 0));

export function sliceCols(a, c0, c1) {
  const w = c1 - c0;
  const out = node(a.rows, w, [a], () => {
    const ga = a.ensureGrad();
    for (let i = 0; i < a.rows; i++) for (let j = 0; j < w; j++) ga[i * a.cols + c0 + j] += out.grad[i * w + j];
  });
  for (let i = 0; i < a.rows; i++) for (let j = 0; j < w; j++) out.data[i * w + j] = a.data[i * a.cols + c0 + j];
  return out;
}

export function concatCols(a, b) {
  const w = a.cols + b.cols;
  const out = node(a.rows, w, [a, b], () => {
    const ga = a.ensureGrad(), gb = b.ensureGrad();
    for (let i = 0; i < a.rows; i++) {
      for (let j = 0; j < a.cols; j++) ga[i * a.cols + j] += out.grad[i * w + j];
      for (let j = 0; j < b.cols; j++) gb[i * b.cols + j] += out.grad[i * w + a.cols + j];
    }
  });
  for (let i = 0; i < a.rows; i++) {
    for (let j = 0; j < a.cols; j++) out.data[i * w + j] = a.data[i * a.cols + j];
    for (let j = 0; j < b.cols; j++) out.data[i * w + a.cols + j] = b.data[i * b.cols + j];
  }
  return out;
}

export function gatherRows(a, indices) {
  const out = node(indices.length, a.cols, [a], () => {
    const ga = a.ensureGrad();
    indices.forEach((src, i) => { for (let j = 0; j < a.cols; j++) ga[src * a.cols + j] += out.grad[i * a.cols + j]; });
  });
  indices.forEach((src, i) => { for (let j = 0; j < a.cols; j++) out.data[i * a.cols + j] = a.data[src * a.cols + j]; });
  return out;
}

/** Normalises every row to zero mean / unit variance, then applies a learned scale and shift. */
export function layerNorm(a, gamma, beta, eps = 1e-5) {
  const { rows, cols } = a;
  const xhat = new Float64Array(a.size);
  const invStd = new Float64Array(rows);
  const out = node(rows, cols, [a, gamma, beta], () => {
    const g = out.grad;
    const ga = a.ensureGrad(), gg = gamma.ensureGrad(), gb = beta.ensureGrad();
    for (let i = 0; i < rows; i++) {
      let sumDy = 0, sumDyXhat = 0;
      for (let j = 0; j < cols; j++) {
        const dy = g[i * cols + j] * gamma.data[j];
        sumDy += dy;
        sumDyXhat += dy * xhat[i * cols + j];
        gg[j] += g[i * cols + j] * xhat[i * cols + j];
        gb[j] += g[i * cols + j];
      }
      for (let j = 0; j < cols; j++) {
        const dy = g[i * cols + j] * gamma.data[j];
        ga[i * cols + j] += (invStd[i] / cols) * (cols * dy - sumDy - xhat[i * cols + j] * sumDyXhat);
      }
    }
  });
  for (let i = 0; i < rows; i++) {
    let mean = 0;
    for (let j = 0; j < cols; j++) mean += a.data[i * cols + j];
    mean /= cols;
    let variance = 0;
    for (let j = 0; j < cols; j++) variance += (a.data[i * cols + j] - mean) ** 2;
    variance /= cols;
    invStd[i] = 1 / Math.sqrt(variance + eps);
    for (let j = 0; j < cols; j++) {
      xhat[i * cols + j] = (a.data[i * cols + j] - mean) * invStd[i];
      out.data[i * cols + j] = xhat[i * cols + j] * gamma.data[j] + beta.data[j];
    }
  }
  return out;
}

/**
 * Fused multi-head self-attention over a batch of `n` sequences of length `len`, stored as
 * stacked rows ([n*len, d]). One op for the whole batch keeps the graph small and the maths fast.
 */
export function attention(q, k, v, n, len, heads) {
  const d = q.cols;
  const dh = d / heads;
  const scale = 1 / Math.sqrt(dh);
  const probs = new Float64Array(n * heads * len * len);
  const out = node(n * len, d, [q, k, v], () => {
    const g = out.grad;
    const gq = q.ensureGrad(), gk = k.ensureGrad(), gv = v.ensureGrad();
    const dp = new Float64Array(len);
    for (let s = 0; s < n; s++) {
      for (let h = 0; h < heads; h++) {
        const pBase = ((s * heads + h) * len) * len;
        const col = h * dh;
        for (let i = 0; i < len; i++) {
          const rowI = (s * len + i) * d + col;
          // dP[i][j] = dO[i] · V[j];  dV[j] += P[i][j] * dO[i]
          for (let j = 0; j < len; j++) {
            const rowJ = (s * len + j) * d + col;
            let acc = 0;
            for (let c = 0; c < dh; c++) { acc += g[rowI + c] * v.data[rowJ + c]; gv[rowJ + c] += probs[pBase + i * len + j] * g[rowI + c]; }
            dp[j] = acc;
          }
          let dot = 0;
          for (let j = 0; j < len; j++) dot += dp[j] * probs[pBase + i * len + j];
          for (let j = 0; j < len; j++) {
            const ds = probs[pBase + i * len + j] * (dp[j] - dot) * scale;
            const rowJ = (s * len + j) * d + col;
            for (let c = 0; c < dh; c++) { gq[rowI + c] += ds * k.data[rowJ + c]; gk[rowJ + c] += ds * q.data[rowI + c]; }
          }
        }
      }
    }
  });
  const scores = new Float64Array(len);
  for (let s = 0; s < n; s++) {
    for (let h = 0; h < heads; h++) {
      const pBase = ((s * heads + h) * len) * len;
      const col = h * dh;
      for (let i = 0; i < len; i++) {
        const rowI = (s * len + i) * d + col;
        let max = -Infinity;
        for (let j = 0; j < len; j++) {
          const rowJ = (s * len + j) * d + col;
          let dot = 0;
          for (let c = 0; c < dh; c++) dot += q.data[rowI + c] * k.data[rowJ + c];
          scores[j] = dot * scale;
          if (scores[j] > max) max = scores[j];
        }
        let total = 0;
        for (let j = 0; j < len; j++) { scores[j] = Math.exp(scores[j] - max); total += scores[j]; }
        for (let j = 0; j < len; j++) probs[pBase + i * len + j] = scores[j] / total;
        for (let j = 0; j < len; j++) {
          const p = probs[pBase + i * len + j];
          const rowJ = (s * len + j) * d + col;
          for (let c = 0; c < dh; c++) out.data[(s * len + i) * d + col + c] += p * v.data[rowJ + c];
        }
      }
    }
  }
  return out;
}

/** Mean squared error against a constant target (same shape), as a 1×1 tensor. */
export function mse(pred, target) {
  const out = node(1, 1, [pred], () => {
    const gp = pred.ensureGrad();
    const scale = (2 * out.grad[0]) / pred.size;
    for (let i = 0; i < pred.size; i++) gp[i] += scale * (pred.data[i] - target[i]);
  });
  let total = 0;
  for (let i = 0; i < pred.size; i++) total += (pred.data[i] - target[i]) ** 2;
  out.data[0] = total / pred.size;
  return out;
}

/** Runs backprop from a scalar loss through everything it depends on. */
export function backward(loss) {
  const order = [];
  const seen = new Set();
  const visit = (t) => {
    if (seen.has(t)) return;
    seen.add(t);
    t.parents.forEach(visit);
    order.push(t);
  };
  visit(loss);
  loss.ensureGrad()[0] = 1;
  for (let i = order.length - 1; i >= 0; i--) order[i].backwardFn?.();
}

export class Adam {
  constructor(params, { lr = 0.01, beta1 = 0.9, beta2 = 0.999, eps = 1e-8 } = {}) {
    this.params = params;
    this.lr = lr; this.beta1 = beta1; this.beta2 = beta2; this.eps = eps;
    this.t = 0;
    this.m = params.map((p) => new Float64Array(p.size));
    this.v = params.map((p) => new Float64Array(p.size));
  }

  zeroGrad() {
    for (const p of this.params) p.grad = null;
  }

  step() {
    this.t += 1;
    const c1 = 1 - this.beta1 ** this.t;
    const c2 = 1 - this.beta2 ** this.t;
    this.params.forEach((p, idx) => {
      if (!p.grad) return;
      const m = this.m[idx], v = this.v[idx];
      for (let i = 0; i < p.size; i++) {
        const g = p.grad[i];
        m[i] = this.beta1 * m[i] + (1 - this.beta1) * g;
        v[i] = this.beta2 * v[i] + (1 - this.beta2) * g * g;
        p.data[i] -= (this.lr * (m[i] / c1)) / (Math.sqrt(v[i] / c2) + this.eps);
      }
    });
  }
}
