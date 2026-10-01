// A small, dependency-free SVG chart: bars, smooth lines and a confidence band on shared x
// categories, with a scrubbing tooltip that works by pointer, touch and arrow keys.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import "./charts.css";

const M = { top: 10, right: 10, bottom: 26, left: 40 };

function niceTicks(min, max, count = 4) {
  if (min === max) { max = min + 1; }
  const span = max - min;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export const compact = (v) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1_000 ? `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k` : String(Math.round(v * 10) / 10));

/** Monotone cubic interpolation (Fritsch–Carlson): smooth, and never overshoots the data. */
function smoothPath(points) {
  if (points.length < 2) return points.length ? `M${points[0][0]},${points[0][1]}` : "";
  const n = points.length;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1][0] - points[i][0]; dy[i] = points[i + 1][1] - points[i][1]; m[i] = dy[i] / dx[i]; }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  tan[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i] / m[i], b = tan[i + 1] / m[i], h = Math.hypot(a, b);
    if (h > 3) { const t = 3 / h; tan[i] = t * a * m[i]; tan[i + 1] = t * b * m[i]; }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const x0 = points[i][0], y0 = points[i][1], x1 = points[i + 1][0], y1 = points[i + 1][1], h = x1 - x0;
    d += `C${x0 + h / 3},${y0 + (tan[i] * h) / 3} ${x1 - h / 3},${y1 - (tan[i + 1] * h) / 3} ${x1},${y1}`;
  }
  return d;
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    setWidth(node.clientWidth);
    if (!("ResizeObserver" in window)) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(node);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * categories: [{ label }]
 * series: [{ id, type: "bar" | "line", values: (number|null)[], color, dashed, name, cellColors }]
 * band: { low: (number|null)[], high: (number|null)[], color }
 * regionFrom: index where a shaded "forecast" region begins
 * tooltip(i) → { title, rows: [{ name, value, color }] }
 */
export function XYChart({ categories, series, band, regionFrom, height = 190, yFormat = compact, tooltip, tid, label, yMin = 0 }) {
  const ref = useRef(null);
  const width = useWidth(ref);
  const uid = useId().replace(/:/g, "");
  const [active, setActive] = useState(null);
  const n = categories.length;

  const geometry = useMemo(() => {
    const all = series.flatMap((s) => s.values).concat(band?.high ?? [], band?.low ?? []).filter((v) => v != null && Number.isFinite(v));
    if (!all.length || !width) return null;
    const lo = Math.min(yMin, ...all);
    const ticks = niceTicks(lo, Math.max(...all), 4);
    const plotW = Math.max(10, width - M.left - M.right);
    const plotH = height - M.top - M.bottom;
    const hasBars = series.some((s) => s.type === "bar");
    const step = plotW / n;
    const xAt = (i) => M.left + (hasBars ? step * (i + 0.5) : n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const y = (v) => M.top + plotH - ((v - ticks[0]) / (ticks.at(-1) - ticks[0])) * plotH;
    return { ticks, plotW, plotH, step, xAt, y, hasBars };
  }, [series, band, width, height, n, yMin]);

  const labelEvery = width ? Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - M.left) / 52)))) : 1;

  const indexFromEvent = (e) => {
    if (!geometry) return null;
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let best = 0, dist = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(geometry.xAt(i) - x); if (d < dist) { dist = d; best = i; } }
    return best;
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); setActive((a) => Math.min(n - 1, (a ?? -1) + 1)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); setActive((a) => Math.max(0, (a ?? n) - 1)); }
    else if (e.key === "Home") { e.preventDefault(); setActive(0); }
    else if (e.key === "End") { e.preventDefault(); setActive(n - 1); }
    else if (e.key === "Escape") setActive(null);
  };

  const tip = active != null && geometry && tooltip ? tooltip(active) : null;
  const tipX = active != null && geometry ? geometry.xAt(active) : 0;

  return (
    <div ref={ref} className="xy" style={{ height }}>
      {geometry && (
        <svg width={width} height={height} role="group" aria-label={label} className="xy__svg">
          <defs>
            <clipPath id={`clip-${uid}`}><rect x={M.left} y={0} width={geometry.plotW} height={height} /></clipPath>
          </defs>
          {geometry.ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={geometry.y(t)} y2={geometry.y(t)} className="xy__grid" />
              <text x={M.left - 8} y={geometry.y(t)} className="xy__tick" textAnchor="end" dominantBaseline="middle">{yFormat(t)}</text>
            </g>
          ))}

          {regionFrom != null && regionFrom < n && (
            <rect x={geometry.xAt(regionFrom) - (geometry.hasBars ? geometry.step / 2 : 0)} y={M.top} width={width - M.right - (geometry.xAt(regionFrom) - (geometry.hasBars ? geometry.step / 2 : 0))} height={geometry.plotH} className="xy__region" />
          )}

          {band && (() => {
            const idx = band.low.map((_, i) => i).filter((i) => band.low[i] != null && band.high[i] != null);
            if (idx.length < 2) return null;
            const top = smoothPath(idx.map((i) => [geometry.xAt(i), geometry.y(band.high[i])]));
            const bottom = smoothPath(idx.map((i) => [geometry.xAt(i), geometry.y(band.low[i])]).reverse());
            return <path className="xy__band" d={`${top}L${bottom.slice(1)}Z`} fill={band.color} />;
          })()}

          {series.filter((s) => s.type === "bar").map((s) =>
            s.values.map((v, i) => {
              if (v == null) return null;
              const bw = Math.min(46, geometry.step * 0.62);
              const x = geometry.xAt(i) - bw / 2;
              const y0 = geometry.y(Math.max(0, geometry.ticks[0]));
              const yv = geometry.y(v);
              return (
                <rect key={`${s.id}${i}`} className={`xy__bar${active === i ? " is-active" : ""}`} x={x} y={Math.min(y0, yv)} width={bw} height={Math.max(2, Math.abs(y0 - yv))} rx={Math.min(6, bw / 3)}
                  fill={s.cellColors?.[i] ?? s.color} style={{ "--i": i }} />
              );
            }))}

          {series.filter((s) => s.type === "line").map((s) => {
            const pts = s.values.map((v, i) => (v == null ? null : [geometry.xAt(i), geometry.y(v)]));
            const runs = [];
            let run = [];
            pts.forEach((p) => { if (p) run.push(p); else if (run.length) { runs.push(run); run = []; } });
            if (run.length) runs.push(run);
            return runs.map((r, k) => (
              <path key={`${s.id}${k}`} d={smoothPath(r)} className={`xy__line${s.dashed ? " is-dashed" : ""}`} stroke={s.color} pathLength={s.dashed ? undefined : 1} clipPath={`url(#clip-${uid})`} />
            ));
          })}

          {series.filter((s) => s.type === "line" && s.dots).map((s) =>
            s.values.map((v, i) => (v == null ? null : <circle key={`${s.id}d${i}`} cx={geometry.xAt(i)} cy={geometry.y(v)} r={active === i ? 5 : 3.2} fill="var(--surface)" stroke={s.color} strokeWidth={2} className="xy__dot" />)))}

          {active != null && <line x1={tipX} x2={tipX} y1={M.top} y2={M.top + geometry.plotH} className="xy__guide" />}
          {active != null && series.filter((s) => s.type === "line" && s.values[active] != null).map((s) => (
            <circle key={`a${s.id}`} cx={tipX} cy={geometry.y(s.values[active])} r={5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
          ))}

          {categories.map((c, i) => (i % labelEvery === 0 ? (
            <text key={`l${i}`} x={geometry.xAt(i)} y={height - 7} className="xy__tick" textAnchor="middle">{c.label}</text>
          ) : null))}

          <rect x={M.left} y={0} width={geometry.plotW} height={height - M.bottom + 4} fill="transparent" className="xy__scrub" tabIndex={0} role="slider" aria-label={`${label} — use arrow keys to inspect values`}
            aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={active ?? 0} data-tid={`${tid}.scrub`}
            onPointerMove={(e) => setActive(indexFromEvent(e))} onPointerDown={(e) => setActive(indexFromEvent(e))} onPointerLeave={() => setActive(null)}
            onFocus={() => setActive((a) => a ?? n - 1)} onBlur={() => setActive(null)} onKeyDown={onKeyDown} />
        </svg>
      )}
      {tip && (
        <div className="xy__tip" style={{ left: Math.min(Math.max(tipX, 74), Math.max(74, width - 74)) }} role="status">
          <div className="xy__tip-title">{tip.title}</div>
          {tip.rows.map((r) => (
            <div key={r.name} className="xy__tip-row"><i style={{ background: r.color }} />{r.name}<b>{r.value}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Donut with an interactive legend; hovering either highlights the matching slice. */
export function Donut({ data, size = 132, format = (v) => `${v}%`, tid, label }) {
  const [active, setActive] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 11;
  const c = 2 * Math.PI * r;
  const lengths = data.map((d) => (d.value / total) * c);
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="donut__svg">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--fill)" strokeWidth={20} />
        {data.map((d, i) => (
          <circle key={d.name} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={active === i ? 24 : 20} strokeDasharray={`${Math.max(0, lengths[i] - 2)} ${c - Math.max(0, lengths[i] - 2)}`}
            strokeDashoffset={-offsets[i]} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="donut__seg" style={{ "--i": i }} />
        ))}
      </svg>
      <ul className="donut__legend">
        {data.map((d, i) => (
          <li key={d.name}>
            <button type="button" data-tid={`${tid}.legend`} className={active === i ? "is-active" : ""} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
              <i style={{ background: d.color }} />{d.name}<b>{format(d.value)}</b>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
