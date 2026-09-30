import { Receipt } from "lucide-react";
import { useMemo, useState } from "react";
import { Donut, XYChart, compact } from "../../charts/XYChart.jsx";
import { CATEGORY_COLOR } from "../../lib/catalog.js";
import { aed } from "../../lib/format.js";
import { useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Segmented } from "../../ui/controls.jsx";
import { Banner, CardSkeleton, Empty, List, ListRow, Meter, NumberTicker, Section, Tag } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";

const Kpi = ({ label, children, delta, bad }) => (
  <div className="kpi"><div className="kpi__label">{label}</div><div className="kpi__value">{children}</div><div className={`kpi__delta${bad ? " is-bad" : ""}`}>{delta}</div></div>
);

function Overview({ enterprise, storeId, token }) {
  const summary = useQuery(`/analytics/summary${enterprise ? "" : `?store_id=${storeId}`}`, { token });
  const movers = useQuery(`/analytics/movers?store_id=${storeId}`, { token, enabled: !enterprise && !!storeId });
  const s = summary.data;

  const trend = useMemo(() => s && ({
    categories: s.sales_trend.map((d) => ({ label: d.day })),
    series: [{ id: "revenue", type: "bar", name: "Revenue", values: s.sales_trend.map((d) => d.revenue), color: "var(--tint)" }],
    tooltip: (i) => ({ title: s.sales_trend[i].day, rows: [{ name: "Revenue", value: aed(s.sales_trend[i].revenue, 0), color: "var(--tint)" }] }),
  }), [s]);

  if (summary.loading) return <CardSkeleton lines={5} />;
  if (summary.error) return <Banner tone="error">{summary.error.message}</Banner>;

  return (
    <>
      <div className="kpi-grid">{s.kpis.map((k) => <Kpi key={k.label} label={k.label} delta={k.delta} bad={!k.good}>{k.value}</Kpi>)}</div>

      {!enterprise && movers.data && (
        <Section title="Selling out fast · last 14 days">
          {movers.data.length === 0 ? <div className="card"><Empty>No customer purchases in this window yet — this fills in as the store sells.</Empty></div> : (
            <List>
              {movers.data.map((m) => (
                <ListRow key={m.product_id} as="div" title={m.product_name} detail={`${m.category} · ${m.units_sold_recent} sold`}
                  aside={m.days_of_supply != null ? <Tag tone={m.days_of_supply < 7 ? "red" : m.days_of_supply < 21 ? "amber" : "green"}>{Math.round(m.days_of_supply)}d of supply</Tag> : null} />
              ))}
            </List>
          )}
        </Section>
      )}

      <div className="grid-2 mt-5">
        <Section title="Sales trend" className="mt-0">
          <div className="card chart-card">
            {s.sales_trend.length === 0 ? <Empty>No sales in this window.</Empty> : <XYChart {...trend} height={190} yFormat={compact} tid="analytics.trend" label="Revenue by day, last seven days" />}
          </div>
        </Section>
        <Section title="Revenue by category" className="mt-0">
          <div className="card">
            <Donut data={s.category_revenue_mix.map((c) => ({ name: c.name, value: c.value, color: CATEGORY_COLOR[c.name] ?? "var(--label-3)" }))} tid="analytics.mix" label="Revenue share by category" />
          </div>
        </Section>
      </div>

      <Section title="Food waste by category">
        <div className="card">
          {s.waste_by_category.length === 0 ? <Empty>No waste recorded yet — this needs batches marked as removed.</Empty> : s.waste_by_category.map((w) => (
            <div key={w.name} className="waste">
              <span className="waste__name">{w.name}</span>
              <Meter pct={w.pct == null ? 0 : Math.min(100, w.pct * 12)} tone="amber" />
              <span className="waste__pct num">{w.pct == null ? "—" : `${w.pct}%`}</span>
            </div>
          ))}
        </div>
      </Section>

      {enterprise && (
        <Section title="Regional comparison">
          <List>
            {s.store_comparison.map((st) => <ListRow key={st.name} as="div" title={st.name} detail={st.code} aside={<b className="num">AED {(st.revenue / 1000).toFixed(1)}K</b>} />)}
          </List>
        </Section>
      )}
    </>
  );
}

function ProfitLoss({ enterprise, storeId, token }) {
  const { data: pnl, loading, error } = useQuery(`/analytics/pnl?${enterprise ? "" : `store_id=${storeId}&`}days=30`, { token });

  const trend = useMemo(() => pnl && ({
    categories: pnl.trend.map((d) => ({ label: d.label })),
    series: [
      { id: "revenue", type: "bar", name: "Net sales", values: pnl.trend.map((d) => d.revenue), color: "color-mix(in srgb, var(--tint) 35%, transparent)" },
      { id: "profit", type: "line", name: "Gross profit", values: pnl.trend.map((d) => d.gross_profit), color: "var(--tint)", dots: true },
    ],
    tooltip: (i) => ({ title: pnl.trend[i].label, rows: [
      { name: "Net sales", value: aed(pnl.trend[i].revenue, 0), color: "var(--tint)" }, { name: "Gross profit", value: aed(pnl.trend[i].gross_profit, 0), color: "var(--tint-strong)" },
    ] }),
  }), [pnl]);

  if (loading) return <CardSkeleton lines={6} />;
  if (error) return <Banner tone="error">{error.message}</Banner>;

  return (
    <>
      <Banner tone="info">Trading P&amp;L, last {pnl.period_days} days — every figure is computed from orders and each product's landed cost. Rent and payroll aren't modelled, so this stops at gross margin.</Banner>
      {pnl.products_missing_cost > 0 && <Banner tone="warn">{pnl.products_missing_cost} sold {pnl.products_missing_cost === 1 ? "product has" : "products have"} no cost price on file, so margin is understated until a cost is added in Procurement → Products.</Banner>}

      <div className="kpi-grid">
        <Kpi label="Net sales" delta={`${pnl.orders} order${pnl.orders === 1 ? "" : "s"}`}>AED <NumberTicker value={pnl.net_sales} decimals={2} /></Kpi>
        <Kpi label="Gross profit" delta="after COGS" bad={pnl.gross_profit < 0}>AED <NumberTicker value={pnl.gross_profit} decimals={2} /></Kpi>
        <Kpi label="Gross margin" delta="of net sales"><NumberTicker value={pnl.margin_pct} decimals={1} suffix="%" /></Kpi>
        <Kpi label="Avg order value" delta="per transaction">AED <NumberTicker value={pnl.avg_order_value} decimals={2} /></Kpi>
      </div>

      <Section title="Revenue to profit">
        <div className="card waterfall">
          <div className="row between"><span>Gross sales</span><span className="num">{aed(pnl.gross_sales)}</span></div>
          <div className="row between muted"><span>Loyalty discounts</span><span className="num">−{aed(pnl.discounts)}</span></div>
          <div className="row between strong waterfall__total"><span>Net sales</span><span className="num">{aed(pnl.net_sales)}</span></div>
          <div className="row between muted"><span>Cost of goods sold</span><span className="num">−{aed(pnl.cogs)}</span></div>
          <div className="row between strong waterfall__total"><span>Gross profit</span><span className="num">{aed(pnl.gross_profit)}</span></div>
        </div>
      </Section>

      <Section title="Net sales and gross profit">
        <div className="card chart-card">
          {pnl.trend.length === 0 ? <Empty icon={Receipt}>No orders in this window yet.</Empty> : (
            <>
              <XYChart {...trend} height={200} tid="analytics.pnl-trend" label="Net sales and gross profit by day" />
              <div className="chart-legend"><span><i style={{ background: "color-mix(in srgb, var(--tint) 35%, transparent)" }} />Net sales</span><span><i style={{ background: "var(--tint)" }} />Gross profit</span></div>
            </>
          )}
        </div>
      </Section>

      <Section title="Margin by category">
        {pnl.by_category.length === 0 ? <div className="card"><Empty>No sales in this window yet.</Empty></div> : (
          <List>
            {pnl.by_category.map((c) => (
              <ListRow key={c.category} as="div">
                <span className="list-row__main">
                  <span className="row between"><span className="list-row__title">{c.category}</span><b className="num">{c.margin_pct}%</b></span>
                  <span className="list-row__detail" style={{ display: "block", marginBottom: 6 }}>{aed(c.revenue, 0)} revenue · {aed(c.cogs, 0)} COGS</span>
                  <Meter pct={Math.max(0, Math.min(100, c.margin_pct))} />
                </span>
              </ListRow>
            ))}
          </List>
        )}
      </Section>

      {enterprise && pnl.by_store.length > 0 && (
        <Section title="Margin by store">
          <List>
            {pnl.by_store.map((s) => (
              <ListRow key={s.store_id} as="div">
                <span className="list-row__main">
                  <span className="row between"><span className="list-row__title">{s.store_name} <span className="muted">{s.store_code}</span></span><b className="num">{s.margin_pct}%</b></span>
                  <span className="list-row__detail" style={{ display: "block", marginBottom: 6 }}>{aed(s.revenue, 0)} revenue · {aed(s.cogs, 0)} COGS</span>
                  <Meter pct={Math.max(0, Math.min(100, s.margin_pct))} />
                </span>
              </ListRow>
            ))}
          </List>
        </Section>
      )}

      <Section title="Business position">
        <div className="kpi-grid kpi-grid--3">
          <Kpi label="Procurement spend" delta="approved and delivered orders">{aed(pnl.procurement_spend, 0)}</Kpi>
          <Kpi label="Shrinkage on hand" delta={`${pnl.shrinkage_units} units written off`} bad={pnl.shrinkage_units > 0}>{aed(pnl.shrinkage_cost, 0)}</Kpi>
          <Kpi label="Loyalty liability" delta="outstanding points, all customers">{aed(pnl.loyalty_liability, 0)}</Kpi>
        </div>
      </Section>
    </>
  );
}

export default function Analytics({ onNav }) {
  const { token, storeMode, activeStoreId, activeStore } = useSession();
  const [tab, setTab] = useState("overview");
  const enterprise = storeMode === "enterprise";
  return (
    <div className="screen">
      <ScreenHeader title="Analytics" subtitle={`${enterprise ? "All stores" : activeStore?.name ?? ""} · ${tab === "overview" ? "last 7 days" : "last 30 days"}`} back={{ label: "Home", tid: "analytics.back", onClick: () => onNav("home") }} />
      <Segmented options={[{ id: "overview", label: "Overview" }, { id: "pnl", label: "Profit & Loss" }]} value={tab} tid="analytics.tab" label="Analytics view" onChange={setTab} className="mb-4" />
      {tab === "overview" ? <Overview enterprise={enterprise} storeId={activeStoreId} token={token} /> : <ProfitLoss enterprise={enterprise} storeId={activeStoreId} token={token} />}
    </div>
  );
}

