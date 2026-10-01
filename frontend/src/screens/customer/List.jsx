import { Receipt, ShoppingBasket, Trash2 } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "../../api.js";
import { aed, plural } from "../../lib/format.js";
import { invalidate, optimistic, useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button, Check, IconButton, Stepper } from "../../ui/controls.jsx";
import { Banner, CardSkeleton, Empty, List, ListRow } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";
import { useToast } from "../../ui/Toast.jsx";

const LIST = "/customer/shopping-list";

export default function CustomerList() {
  const { token, customerStoreId, stores, refreshMe } = useSession();
  const toast = useToast();
  const { data: items, loading, error: loadError } = useQuery(LIST, { token });
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);

  // Ticks, quantities and removals show up instantly and are rolled back only if the change is refused.
  async function change(item, body) {
    setError("");
    try {
      await optimistic(LIST, (prev = []) => prev.map((i) => (i.id === item.id ? { ...i, ...body } : i)), () => apiFetch(`${LIST}/${item.id}`, { method: "PATCH", token, body }));
    } catch (err) { setError(err.message); }
  }

  async function remove(item) {
    setError("");
    try {
      await optimistic(LIST, (prev = []) => prev.filter((i) => i.id !== item.id), () => apiFetch(`${LIST}/${item.id}`, { method: "DELETE", token }));
    } catch (err) { setError(err.message); }
  }

  async function checkout() {
    setCheckingOut(true);
    setError("");
    try {
      const order = await apiFetch("/customer/checkout", { method: "POST", token, body: { store_id: customerStoreId } });
      setReceipt(order);
      invalidate(LIST);
      invalidate("/customer/receipts");
      invalidate("/customer/recommendations");
      refreshMe();
      toast.show(`Checked out — ${aed(order.total)}`);
    } catch (err) { setError(err.message); } finally { setCheckingOut(false); }
  }

  const checked = (items ?? []).filter((i) => i.checked);
  const storeName = stores.find((s) => s.id === customerStoreId)?.name;

  return (
    <div className="screen">
      <ScreenHeader title="Shopping List" subtitle={storeName ? `Checking out at ${storeName}` : undefined} />
      <Banner tone="error">{error || loadError?.message}</Banner>

      {receipt && (
        <div className="card card--tint receipt mb-4" role="status">
          <Receipt size={20} aria-hidden="true" />
          <div>
            <div className="t-headline">Thanks — {aed(receipt.total)}</div>
            <div className="t-sub receipt__sub">You earned {receipt.loyalty_points_earned} loyalty points on {plural(receipt.items.length, "item")}.</div>
          </div>
        </div>
      )}

      {loading ? <CardSkeleton lines={4} /> : items.length === 0 ? (
        <div className="card"><Empty icon={ShoppingBasket}>Your list is empty. Use “Find a product” on Home to add something.</Empty></div>
      ) : (
        <List>
          {items.map((item) => (
            <ListRow key={item.id} as="div">
              <Check checked={item.checked} label={`Include ${item.product.name}`} tid="list.check" onChange={(value) => change(item, { checked: value })} />
              <span className="list-row__main">
                <span className="list-row__title">{item.product.name}</span>
                <span className="list-row__detail" style={{ display: "block" }}>{aed(item.product.price)} / {item.product.unit}</span>
              </span>
              <Stepper value={item.quantity} label={item.product.name} tid="list.qty" onChange={(q) => change(item, { quantity: q })} />
              <IconButton label={`Remove ${item.product.name}`} tid="list.remove" plain onClick={() => remove(item)}><Trash2 size={17} aria-hidden="true" /></IconButton>
            </ListRow>
          ))}
        </List>
      )}

      {checked.length > 0 && (
        <div className="sticky-cta">
          <Button block size="lg" tid="list.checkout" loading={checkingOut} onClick={checkout}>
            Check out {plural(checked.length, "item")} · {aed(checked.reduce((s, i) => s + i.product.price * i.quantity, 0))}
          </Button>
        </div>
      )}
    </div>
  );
}
