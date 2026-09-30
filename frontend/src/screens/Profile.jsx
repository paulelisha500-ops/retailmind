import { BarChart3, Bell, Check as CheckIcon, CreditCard, LogOut, Moon, RotateCcw, Store } from "lucide-react";
import { useState } from "react";
import { EDITION, apiFetch } from "../api.js";
import { aed, fmtDate, loyaltyTier, plural } from "../lib/format.js";
import { readTheme, setTheme } from "../lib/theme.js";
import { useQuery } from "../lib/query.js";
import { useSession } from "../session.jsx";
import { Button, Segmented, Switch } from "../ui/controls.jsx";
import { Avatar, Banner, Collapse, Empty, List, ListRow, Section, Skeleton, Tag } from "../ui/display.jsx";
import { ConfirmSheet } from "../ui/Sheet.jsx";
import { ScreenHeader } from "../ui/ScreenHeader.jsx";
import { useToast } from "../ui/Toast.jsx";

const THEMES = [{ id: "auto", label: "Automatic" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }];

const NOTIFICATION_PREFS = [
  ["notify_restock", "Stock alerts", "Low stock, out of stock and quality alerts in the bell on Home"],
  ["notify_security", "Loss-prevention alerts", "Theft and security flags from monitoring"],
  ["notify_orders", "Payment notifications", "Customer checkouts, as they happen"],
];

export default function Profile({ onNav }) {
  const { me, setMe, token, isEmployee, isAdmin, stores, storeLabel, customerStoreId, signOut } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [theme, setThemeState] = useState(readTheme);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [savingStore, setSavingStore] = useState(false);
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  const receipts = useQuery("/customer/receipts", { token, enabled: open === "payments" && !isEmployee });
  const pnl = useQuery("/analytics/pnl?days=30", { token, enabled: open === "payments" && isAdmin });
  const toggle = (panel) => setOpen((p) => (p === panel ? null : panel));

  async function savePrefs(next) {
    setSavingPrefs(true);
    setError("");
    try {
      setMe(await apiFetch("/auth/me", { method: "PATCH", token, body: next }));
      toast.show("Notification settings saved");
    } catch (err) { setError(err.message); } finally { setSavingPrefs(false); }
  }

  async function chooseStore(id) {
    setSavingStore(true);
    setError("");
    try {
      setMe(await apiFetch("/auth/me", { method: "PATCH", token, body: { preferred_store_id: id } }));
      toast.show("Preferred store updated");
    } catch (err) { setError(err.message); } finally { setSavingStore(false); }
  }

  async function resetWorkspace() {
    setResetting(true);
    try {
      await apiFetch("/workspace/reset", { method: "POST", token });
      setConfirmReset(false);
      signOut("Workspace reset to its original data — sign in again.");
    } catch (err) {
      setError(err.message);
      setConfirmReset(false);
    } finally { setResetting(false); }
  }

  const roleLabel = !isEmployee ? "Customer" : isAdmin ? "Admin" : me.access_level[0].toUpperCase() + me.access_level.slice(1);
  const sub = isEmployee ? me.title : `${loyaltyTier(me.loyalty_points)} · ${me.loyalty_points} pts`;

  return (
    <div className="screen screen--narrow">
      <ScreenHeader title="Profile" />
      <div className="profile-head">
        <Avatar name={me.name} large />
        <div><div className="t-headline">{me.name}</div><div className="t-sub">{sub}</div><div className="mt-2"><Tag>{roleLabel}</Tag></div></div>
      </div>

      <Banner tone="error">{error}</Banner>

      <List>
        {(isAdmin || !isEmployee) && (
          <>
            <ListRow tid="profile.payments" icon={isAdmin ? BarChart3 : CreditCard} iconTone="blue" title={isAdmin ? "Business" : "Payment history"} chevron open={open === "payments"} onClick={() => toggle("payments")} />
            <Collapse open={open === "payments"}>
              <div className="list-foot">
                {isAdmin ? (
                  pnl.loading ? <Skeleton lines={2} /> : pnl.data && (
                    <>
                      <p className="t-foot mb-3">Whole business, last {pnl.data.period_days} days — all stores.</p>
                      <div className="row gap-2 wrap mb-3">
                        <Tag tone="green">{aed(pnl.data.net_sales, 0)} net sales</Tag>
                        <Tag tone={pnl.data.gross_profit >= 0 ? "green" : "red"}>{aed(pnl.data.gross_profit, 0)} gross profit</Tag>
                        <Tag>{pnl.data.margin_pct}% margin</Tag>
                        <Tag>{plural(pnl.data.orders, "order")}</Tag>
                      </div>
                      <Button variant="tint" size="sm" tid="profile.open-pnl" onClick={() => onNav("analytics")}>Open full Profit &amp; Loss</Button>
                    </>
                  )
                ) : receipts.loading ? <Skeleton lines={2} /> : receipts.data?.length ? (
                  <div className="stack gap-2">
                    <p className="t-foot">RetailMind never stores card numbers — checkout runs on your loyalty account.</p>
                    {receipts.data.slice(0, 8).map((r) => (
                      <div key={r.id} className="receipt-row"><b>{aed(r.total)}</b> · {plural(r.items.length, "item")} · +{r.loyalty_points_earned} pts<div className="t-foot">{fmtDate(r.created_at)}</div></div>
                    ))}
                  </div>
                ) : <Empty icon={CreditCard}>No orders yet — check out from your list to see receipts here.</Empty>}
              </div>
            </Collapse>
          </>
        )}

        {isEmployee && (
          <>
            <ListRow tid="profile.notifications" icon={Bell} iconTone="red" title="Notifications" chevron open={open === "notifications"} onClick={() => toggle("notifications")} />
            <Collapse open={open === "notifications"}>
              <div className="list-foot">
                {NOTIFICATION_PREFS.map(([key, title, detail]) => (
                  <label key={key} className="pref">
                    <span><span className="strong">{title}</span><span className="t-foot" style={{ display: "block" }}>{detail}</span></span>
                    <Switch checked={!!me[key]} disabled={savingPrefs} label={title} tid={`profile.pref.${key}`} onChange={(value) => savePrefs({ [key]: value })} />
                  </label>
                ))}
              </div>
            </Collapse>
          </>
        )}

        <ListRow tid="profile.store" icon={Store} iconTone="amber" title="Store" detail={isEmployee ? storeLabel : undefined} chevron open={open === "store"} onClick={() => toggle("store")} />
        <Collapse open={open === "store"}>
          <div className="list-foot">
            {!isEmployee ? (
              <>
                <p className="t-foot mb-2">{me.preferred_store_id ? "Your shopping list checks out at this store." : "No preference set yet — checkout uses the store marked below."}</p>
                <div className="store-options">
                  {stores.map((s) => (
                    <button key={s.id} type="button" data-tid="profile.store.choose" className="store-option" disabled={savingStore} onClick={() => chooseStore(s.id)}>
                      <span><span className="strong">{s.name} {s.code}</span>{(s.region || s.is_headquarters) && <span className="t-foot" style={{ display: "block" }}>{s.region}{s.region && s.is_headquarters ? " · " : ""}{s.is_headquarters ? "Headquarters" : ""}</span>}</span>
                      {customerStoreId === s.id && <CheckIcon size={18} className="store-option__tick" aria-label="Selected" />}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="t-foot">You're assigned to <b>{storeLabel || "no store yet"}</b>. Store assignment is managed from Team &amp; Access{isAdmin ? "." : " by an admin."}</p>
                {isAdmin && <Button variant="tint" size="sm" className="mt-3" tid="profile.go-team" onClick={() => onNav("team")}>Go to Team &amp; Access</Button>}
              </>
            )}
          </div>
        </Collapse>

        <ListRow tid="profile.appearance" icon={Moon} iconTone="plum" title="Appearance" chevron open={open === "appearance"} onClick={() => toggle("appearance")} />
        <Collapse open={open === "appearance"}>
          <div className="list-foot">
            <Segmented options={THEMES} value={theme} tid="profile.theme" label="Appearance" onChange={(t) => { setThemeState(t); setTheme(t); }} />
          </div>
        </Collapse>
      </List>

      {isAdmin && EDITION === "browser" && (
        <Section title="Workspace">
          <List>
            <ListRow tid="profile.reset" icon={RotateCcw} iconTone="red" title="Reset workspace data" detail="Restore the original stores, stock, sales and accounts" onClick={() => setConfirmReset(true)} chevron />
          </List>
          <p className="hint mt-2">This workspace is stored in your browser. Resetting removes every change you've made.</p>
        </Section>
      )}

      <Button variant="gray" block className="mt-5" tid="profile.sign-out" icon={LogOut} onClick={() => signOut()}>Sign out</Button>

      <ConfirmSheet open={confirmReset} onClose={() => setConfirmReset(false)} onConfirm={resetWorkspace} busy={resetting} tid="profile.reset-confirm"
        title="Reset workspace data?" message="Every change you've made in this browser — products, suppliers, orders, team members — will be replaced by the original data, and you'll be signed out." confirmLabel="Reset workspace" />
    </div>
  );
}
