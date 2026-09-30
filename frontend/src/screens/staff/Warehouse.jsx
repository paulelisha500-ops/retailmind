import { Clock, MapPin } from "lucide-react";
import { useMemo } from "react";
import { XYChart } from "../../charts/XYChart.jsx";
import { useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Banner, CardSkeleton, Empty, List, ListRow, Meter, Section, Tag } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";

const BAR = (level) => (level >= 70 ? "var(--red)" : level >= 50 ? "var(--amber)" : "var(--tint)");

export default function Warehouse({ onNav }) {
  const { token, activeStoreId } = useSession();
  const enabled = !!activeStoreId;
  const zones = useQuery(`/warehouse/zones?store_id=${activeStoreId}`, { token, enabled });
  const route = useQuery(`/warehouse/pick-route?store_id=${activeStoreId}`, { token, enabled });
  const traffic = useQuery(`/warehouse/congestion?store_id=${activeStoreId}`, { token, enabled });
  const staffing = useQuery(`/warehouse/staffing?store_id=${activeStoreId}`, { token, enabled });
  const error = zones.error ?? route.error ?? traffic.error ?? staffing.error;

  const chart = useMemo(() => traffic.data?.length ? ({
    categories: traffic.data.map((c) => ({ label: c.hour })),
    series: [{ id: "level", type: "bar", name: "Traffic", values: traffic.data.map((c) => c.level), color: "var(--tint)", cellColors: traffic.data.map((c) => BAR(c.level)) }],
    tooltip: (i) => ({ title: traffic.data[i].hour, rows: [{ name: "Avg transactions/hr", value: String(traffic.data[i].transaction_count), color: BAR(traffic.data[i].level) }] }),
  }) : null, [traffic.data]);

  return (
    <div className="screen">
      <ScreenHeader title="Warehouse" subtitle="Storage, picking and workforce planning" back={{ label: "Home", tid: "warehouse.back", onClick: () => onNav("home") }} />
      <Banner tone="error">{error?.message}</Banner>

      <Section title="Storage utilisation">
        {zones.loading ? <CardSkeleton /> : zones.data?.length ? (
          <div className="card stack gap-4">
            {zones.data.map((z) => (
              <div key={z.id}>
                <div className="row between mb-2"><span className="strong">{z.name}</span><Tag tone={z.pct >= 90 ? "red" : z.pct >= 75 ? "amber" : "green"}>{z.pct}%</Tag></div>
                <Meter pct={z.pct} tone={z.pct >= 90 ? "red" : z.pct >= 75 ? "amber" : undefined} />
                <div className="t-foot mt-1">{z.current_units.toLocaleString()} of {z.capacity_units.toLocaleString()} units</div>
              </div>
            ))}
          </div>
        ) : <div className="card"><Empty>No zones are configured for this store.</Empty></div>}
      </Section>

      <div className="grid-2">
        <Section title={`Pick route · ${route.data?.length ?? 0} stops`}>
          {route.loading ? <CardSkeleton /> : route.data?.length ? (
            <List>
              {route.data.map((r) => (
                <ListRow key={r.step} as="div">
                  <span className="step">{r.step}</span>
                  <span className="list-row__main"><span className="list-row__title row gap-1"><MapPin size={13} aria-hidden="true" />{r.location}</span><span className="list-row__detail" style={{ display: "block" }}>{r.task}</span></span>
                </ListRow>
              ))}
            </List>
          ) : <div className="card"><Empty>Nothing needs attention right now — no route to run.</Empty></div>}
          <p className="hint mt-2"><Clock size={12} aria-hidden="true" style={{ display: "inline", verticalAlign: "-2px" }} /> Built live from open alerts and batches expiring within 3 days, ordered by aisle.</p>
        </Section>

        <Section title="Floor traffic by hour">
          <div className="card chart-card">
            {traffic.loading ? <div className="skeleton" style={{ height: 150 }} /> : chart ? <XYChart {...chart} height={170} yFormat={(v) => `${Math.round(v)}`} tid="warehouse.traffic" label="Average checkout traffic by hour of day" /> : <Empty>No transaction history yet.</Empty>}
            <p className="t-foot center mt-2">Average transactions per hour, last 21 days, relative to this store's busiest hour.</p>
          </div>
        </Section>
      </div>

      {staffing.data && <Banner tone="info">Recommended {staffing.data.day} floor staff: <b>{staffing.data.recommended_staff}</b> (baseline {staffing.data.baseline_staff}). {staffing.data.reason}</Banner>}
    </div>
  );
}
