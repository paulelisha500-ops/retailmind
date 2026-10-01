import { BarChart3, Bell, ClipboardList, MessageCircle, Package, ShoppingCart, TrendingUp, Truck, Users, Video } from "lucide-react";
import { useState } from "react";
import { taskTone } from "../../lib/catalog.js";
import { firstName } from "../../lib/format.js";
import { useStoreQuery } from "../../lib/hooks.js";
import { useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button, IconButton } from "../../ui/controls.jsx";
import { Banner, CardSkeleton, Empty, List, ListRow, Section, Tag } from "../../ui/display.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";

const KIND_LABEL = { restock: "Restock", order: "Payment", alert: "Alert" };

function NotificationBell() {
  const { token, activeStoreId } = useSession();
  const [open, setOpen] = useState(false);
  const { data: items = [], refetch } = useQuery(`/notifications?store_id=${activeStoreId}`, { token, enabled: !!activeStoreId, refetchMs: 30_000 });

  return (
    <>
      <div className="bell">
        <IconButton label={items.length ? `Notifications, ${items.length} new` : "Notifications"} tid="home.bell" onClick={() => { setOpen(true); refetch().catch(() => {}); }}>
          <Bell size={18} aria-hidden="true" />
        </IconButton>
        {items.length > 0 && <span className="bell__badge" aria-hidden="true">{items.length}</span>}
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications" tid="home.notifications">
        {items.length === 0 ? <Empty icon={Bell}>All clear — nothing needs attention.</Empty> : (
          <List>
            {items.map((n) => (
              <ListRow key={n.id} as="div">
                <span className="list-row__main">
                  <Tag tone={n.severity === "green" ? "green" : n.severity}>{KIND_LABEL[n.kind] ?? n.kind}</Tag>
                  <span className="list-row__title" style={{ display: "block", marginTop: 6 }}>{n.title}</span>
                  <span className="list-row__detail" style={{ display: "block" }}>{n.detail}</span>
                </span>
              </ListRow>
            ))}
          </List>
        )}
      </Sheet>
    </>
  );
}

export default function StaffHome({ onNav }) {
  const { me, isAdmin, storeMode, storeLabel } = useSession();
  const tasks = useStoreQuery("tasks");
  const alerts = useStoreQuery("alerts");
  const openTasks = (tasks.data ?? []).filter((t) => !t.done);
  const openAlerts = (alerts.data ?? []).filter((a) => a.status !== "resolved").length;

  const tiles = [
    { id: "cashier", label: "Cashier", Icon: ShoppingCart, tone: "green" },
    { id: "tasks", label: "Tasks", Icon: ClipboardList, tone: "green", count: openTasks.length },
    { id: "monitoring", label: "Monitoring", Icon: Video, tone: "red", count: openAlerts },
    { id: "forecast", label: "Forecast", Icon: TrendingUp, tone: "blue" },
    { id: "procurement", label: "Procurement", Icon: Truck, tone: "plum" },
    { id: "assistant", label: "Ask RetailMind", Icon: MessageCircle, tone: "blue" },
    { id: "warehouse", label: "Warehouse", Icon: Package, tone: "amber" },
    ...(isAdmin ? [{ id: "team", label: "Team & Access", Icon: Users, tone: "amber" }, { id: "analytics", label: "Analytics", Icon: BarChart3, tone: "green" }] : []),
  ];

  return (
    <div className="screen">
      <ScreenHeader title={`Hi, ${firstName(me.name)}`} subtitle={storeLabel ? `${me.title} · ${storeLabel}` : me.title} actions={<NotificationBell />} />

      <div className="tile-grid">
        {tiles.map(({ id, label, Icon, tone, count }) => (
          <button key={id} type="button" data-tid={`home.tile.${id}`} className={`tile tile--${tone}`} onClick={() => onNav(id)}>
            <span className="tile__icon"><Icon size={19} aria-hidden="true" /></span>
            {label}
            {!!count && <span className="tile__count" aria-label={`${count} open`}>{count}</span>}
          </button>
        ))}
      </div>

      <Section title="My tasks today" action={<Button variant="plain" size="sm" tid="home.all-tasks" onClick={() => onNav("tasks")}>See all</Button>}>
        {tasks.loading ? <CardSkeleton /> : openTasks.length === 0 ? (
          <div className="card"><Empty icon={ClipboardList}>All caught up — nice work.</Empty></div>
        ) : (
          <List>
            {openTasks.slice(0, 3).map((t) => (
              <ListRow key={t.id} as="div">
                <span className="list-row__main"><Tag tone={taskTone(t.source)}>{t.source}</Tag><span className="list-row__title" style={{ display: "block", marginTop: 6 }}>{t.title}</span></span>
              </ListRow>
            ))}
          </List>
        )}
      </Section>

      {storeMode === "enterprise" && isAdmin && <Banner tone="info">Enterprise mode — viewing {storeLabel}. Switch stores from Team &amp; Access.</Banner>}
    </div>
  );
}
