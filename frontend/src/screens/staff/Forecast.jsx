import { RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { XYChart } from "../../charts/XYChart.jsx";
import { CATEGORIES, FORECAST_METHODS } from "../../lib/catalog.js";
import { useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Chip, Segmented } from "../../ui/controls.jsx";
import { Banner } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";

const SLOW = new Set(["lstm", "tft"]);

export default function Forecast() {
  const { token, activeStoreId, storeLabel } = useSession();
  const [method, setMethod] = useState("prophet");
  const [category, setCategory] = useState("Dairy & Chilled");
  const info = FORECAST_METHODS.find((m) => m.id === method);

  const path = `/forecast/${encodeURIComponent(category)}?store_id=${activeStoreId}&model=${method}&horizon_days=7`;
  const { data, loading, error } = useQuery(path, { token, enabled: !!activeStoreId });

  const chart = useMemo(() => {
    if (!data) return null;
    const pts = data.points;
    return {
      categories: pts.map((p) => ({ label: p.label })),
      series: [
        { id: "actual", type: "line", name: "Actual", values: pts.map((p) => p.actual), color: "var(--label)" },
        { id: "predicted", type: "line", name: "Forecast", values: pts.map((p) => p.predicted), color: "var(--tint)", dashed: true },
      ],
      band: { low: pts.map((p) => p.band_low), high: pts.map((p) => p.band_high), color: "var(--blue)" },
      regionFrom: pts.findIndex((p) => p.kind === "forecast"),
      tooltip: (i) => {
        const p = pts[i];
        const rows = [];
        if (p.actual != null) rows.push({ name: "Actual", value: `${Math.round(p.actual)} units`, color: "var(--label)" });
        if (p.kind === "forecast") rows.push({ name: "Forecast", value: `${Math.round(p.predicted)} units`, color: "var(--tint)" });
        if (p.band_low != null) rows.push({ name: "Likely range", value: `${Math.round(p.band_low)}–${Math.round(p.band_high)}`, color: "var(--blue)" });
        return { title: p.label, rows };
      },
    };
  }, [data]);

  const unavailable = error?.status === 501;
  const accuracy = data?.mape == null ? "Not enough history for an accuracy score yet"
    : `${data.mape_kind === "training_fit" ? "Training fit" : "Backtest error"} ${data.mape.toFixed(1)}% MAPE${data.mape_kind === "backtest" ? " · last 7 days held out" : ""}${data.confidence != null ? ` · ${Math.round(data.confidence * 100)}% confidence` : ""}`;

  return (
    <div className="screen">
      <ScreenHeader title="Forecast" subtitle={`Demand prediction and auto-reorder · ${storeLabel}`} />

      <div className="chip-row" role="group" aria-label="Category">
        {CATEGORIES.map((c) => <Chip key={c.id} icon={c.Icon} active={c.id === category} tid="forecast.category" onClick={() => setCategory(c.id)}>{c.id}</Chip>)}
      </div>

      <Segmented options={FORECAST_METHODS.map((m) => ({ id: m.id, label: m.label }))} value={method} tid="forecast.method" label="Forecasting method" onChange={setMethod} />
      <p className="t-sub mt-3 mb-4 method-desc">{info.desc}</p>

      {loading && (
        <div className="card chart-card" aria-busy="true">
          <div className="training"><span className="spinner" aria-hidden="true" />{SLOW.has(method) ? `Training the ${info.label} network on this store's sales history — a couple of seconds…` : `Fitting ${info.label.toLowerCase()} to this store's sales history…`}</div>
          <div className="skeleton" style={{ height: 190 }} />
        </div>
      )}

      {unavailable && <Banner tone="warn">{info.label} needs more history for this store and category. {error.message}</Banner>}
      {error && !unavailable && <Banner tone="error">{error.message}</Banner>}

      {data && chart && (
        <>
          <div className="card chart-card">
            <XYChart {...chart} height={220} tid="forecast.chart" label={`${data.category} demand: recent sales and the forecast`} />
            <div className="chart-legend">
              <span><i style={{ background: "var(--label)" }} />Actual</span>
              <span><i style={{ background: "var(--tint)" }} />Forecast</span>
              <span><i style={{ background: "var(--blue)", opacity: 0.4 }} />Likely range</span>
            </div>
          </div>

          <div className="card card--dark reco-card mt-3">
            <Sparkles size={18} aria-hidden="true" />
            <div>{data.recommendation}{data.recommended_po_quantity ? ` Suggested reorder: ${data.recommended_po_quantity.toLocaleString()} units (includes 10% safety stock).` : ""}</div>
          </div>

          <p className="t-foot center mt-3"><RefreshCw size={12} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px" }} /> {accuracy} · trained live from this store's sales</p>
        </>
      )}
    </div>
  );
}
