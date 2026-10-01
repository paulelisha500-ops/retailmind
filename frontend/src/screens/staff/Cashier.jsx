import { ChevronLeft, Receipt, Search, ShoppingCart, UserPlus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "../../lib/catalog.js";
import { aed, fmtDate, loyaltyTier, plural } from "../../lib/format.js";
import { useGlobalQuery } from "../../lib/hooks.js";
import { invalidate } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button, Field, IconButton, IconInput, Input, Segmented, Stepper } from "../../ui/controls.jsx";
import { Avatar, Banner, CardSkeleton, Empty, List, ListRow, Section, Tag } from "../../ui/display.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";
import { useToast } from "../../ui/Toast.jsx";

const POINTS_TO_AED = 0.01; // 100 points = AED 1
const BLANK_CUSTOMER = { name: "", phone: "", email: "" };

function EnrollSheet({ open, onClose, onEnrolled }) {
  const { token } = useSession();
  const [form, setForm] = useState(BLANK_CUSTOMER);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reset = () => { setForm(BLANK_CUSTOMER); setError(""); };
  const close = () => { reset(); onClose(); };

  async function submit() {
    if (!form.name.trim() || !form.phone.trim()) { setError("Enter a name and a phone number."); return; }
    setBusy(true);
    setError("");
    try {
      const created = await apiFetch("/pos/customers", { method: "POST", token, body: { name: form.name, phone: form.phone, email: form.email || undefined } });
      invalidate("/pos/customers");
      reset();
      onEnrolled(created);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={close} title="New loyalty member" size="sm" tid="cashier.enroll"
      actions={<><Button variant="gray" tid="cashier.enroll.cancel" onClick={close}>Cancel</Button><Button tid="cashier.enroll.submit" loading={busy} onClick={submit}>Enroll</Button></>}>
      <Banner tone="error">{error}</Banner>
      <Field label="Name"><Input tid="cashier.enroll.name" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label="Phone number" hint="If this number is already on file, the existing member is used."><Input tid="cashier.enroll.phone" type="tel" placeholder="+971 …" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      <Field label="Email (optional)"><Input tid="cashier.enroll.email" type="email" placeholder="name@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
    </Sheet>
  );
}

function Checkout() {
  const { token, activeStoreId } = useSession();
  const toast = useToast();
  const products = useGlobalQuery("products");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [customerSearch, setCustomerSearch] = useState("");
  const [results, setResults] = useState([]);
  const [enrolling, setEnrolling] = useState(false);
  const [redeem, setRedeem] = useState("");
  const [method, setMethod] = useState(null);
  const [tendered, setTendered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return (products.data ?? []).filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || "").includes(q)).slice(0, 8);
  }, [search, products.data]);

  useEffect(() => {
    if (customer || !customerSearch.trim()) return undefined;
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch(`/pos/customers?search=${encodeURIComponent(customerSearch.trim())}`, { token }).then((r) => { if (!cancelled) setResults(r); }).catch(() => {});
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [customerSearch, customer, token]);

  const addToCart = (product) => {
    setCart((prev) => (prev.some((l) => l.product.id === product.id) ? prev.map((l) => (l.product.id === product.id ? { ...l, qty: Math.min(999, l.qty + 1) } : l)) : [...prev, { product, qty: 1 }]));
    setSearch("");
  };
  const setQty = (id, qty) => setCart((prev) => prev.map((l) => (l.product.id === id ? { ...l, qty } : l)));
  const removeLine = (id) => setCart((prev) => prev.filter((l) => l.product.id !== id));

  // A barcode scanner types the code then presses Enter: add an exact barcode/SKU match straight away.
  const onSearchKey = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = search.trim().toLowerCase();
    const exact = (products.data ?? []).find((p) => p.barcode === q || p.sku.toLowerCase() === q);
    if (exact) addToCart(exact);
    else if (matches.length === 1) addToCart(matches[0]);
  };

  const attach = (c) => { setCustomer(c); setCustomerSearch(""); setResults([]); setRedeem(""); };
  const customerMatches = customer || !customerSearch.trim() ? [] : results;

  const subtotal = cart.reduce((s, l) => s + l.product.price * l.qty, 0);
  const maxPoints = customer ? Math.min(customer.loyalty_points || 0, Math.floor(subtotal / POINTS_TO_AED)) : 0;
  const points = Math.max(0, Math.min(Number(redeem) || 0, maxPoints));
  const total = Math.max(0, subtotal - points * POINTS_TO_AED);
  const change = (Number(tendered) || 0) - total;
  const shortTender = method === "cash" && (Number(tendered) || 0) < total - 0.004;
  const canComplete = cart.length > 0 && !!method && !shortTender;

  async function complete() {
    if (!canComplete || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = { store_id: activeStoreId, customer_id: customer?.id || null, items: cart.map((l) => ({ product_id: l.product.id, quantity: l.qty })), payment_method: method, points_to_redeem: points };
      if (method === "cash") body.amount_tendered = Number(tendered) || 0;
      const order = await apiFetch("/pos/checkout", { method: "POST", token, body });
      setReceipt(order);
      setCart([]); setCustomer(null); setCustomerSearch(""); setRedeem(""); setMethod(null); setTendered("");
      invalidate("/pos/customers");
      invalidate("/notifications");
      invalidate("/tasks");
      toast.show(`Sale complete — ${aed(order.total)}`);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (receipt) {
    return (
      <div className="card receipt-card">
        <div className="t-cap">Sale complete</div>
        <div className="receipt-card__total num">{aed(receipt.total)}</div>
        <p className="t-sub mb-3">
          {receipt.customer_name} · {PAYMENT_LABEL[receipt.payment_method] ?? receipt.payment_method}
          {receipt.payment_method === "cash" && receipt.change_due > 0 ? ` · Change due ${aed(receipt.change_due)}` : ""}
        </p>
        <List>
          {receipt.items.map((it) => <ListRow key={it.product_id} as="div" title={`${it.quantity}× ${it.product.name}`} aside={aed(it.unit_price * it.quantity)} />)}
        </List>
        {receipt.loyalty_points_earned > 0 && <Banner tone="success">{receipt.loyalty_points_earned} loyalty points earned{receipt.points_redeemed > 0 ? ` · ${receipt.points_redeemed} redeemed` : ""}</Banner>}
        <Button block icon={ShoppingCart} className="mt-4" tid="cashier.new-sale" onClick={() => setReceipt(null)}>New sale</Button>
      </div>
    );
  }

  return (
    <div className="pos">
      <div className="pos__main">
        <div className="card mb-3">
          <IconInput icon={Search} tid="cashier.search" type="search" placeholder="Search products by name, SKU or barcode…" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} />
          {search.trim() && (
            <div className="mt-3">
              {matches.length === 0 ? <Empty>No matches.</Empty> : (
                <List>{matches.map((p) => <ListRow key={p.id} tid="cashier.add-product" onClick={() => addToCart(p)} title={p.name} detail={`${p.sku} · ${p.category}`} aside={aed(p.price)} />)}</List>
              )}
            </div>
          )}
        </div>

        <Section title={`Cart${cart.length ? ` · ${plural(cart.reduce((s, l) => s + l.qty, 0), "item")}` : ""}`}>
          {cart.length === 0 ? <div className="card"><Empty icon={ShoppingCart}>Search above to add items to this sale.</Empty></div> : (
            <List>
              {cart.map((l) => (
                <ListRow key={l.product.id} as="div">
                  <span className="list-row__main"><span className="list-row__title">{l.product.name}</span><span className="list-row__detail" style={{ display: "block" }}>{aed(l.product.price)} / {l.product.unit}</span></span>
                  <Stepper value={l.qty} label={l.product.name} tid="cashier.qty" onChange={(q) => setQty(l.product.id, q)} />
                  <b className="num cart-total">{aed(l.product.price * l.qty)}</b>
                  <IconButton label={`Remove ${l.product.name}`} tid="cashier.remove-line" plain onClick={() => removeLine(l.product.id)}><X size={16} aria-hidden="true" /></IconButton>
                </ListRow>
              ))}
            </List>
          )}
        </Section>
      </div>

      <div className="pos__side">
        <div className="card mb-3">
          <div className="t-cap mb-2">Customer (optional)</div>
          {customer ? (
            <div className="member">
              <Avatar name={customer.name} />
              <div className="grow"><div className="strong">{customer.name}</div><div className="t-foot">{customer.phone || customer.email} · {customer.loyalty_points} pts</div></div>
              <Button variant="gray" size="sm" tid="cashier.change-customer" onClick={() => { setCustomer(null); setRedeem(""); }}>Change</Button>
            </div>
          ) : (
            <>
              <IconInput icon={Search} tid="cashier.customer-search" placeholder="Search by name or phone…" aria-label="Search customers" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} />
              {customerSearch.trim() && (
                <div className="mt-3">
                  {customerMatches.length === 0 ? <Empty>No match — ring it up as a walk-in, or enroll them.</Empty> : (
                    <List>{customerMatches.map((c) => <ListRow key={c.id} tid="cashier.attach-customer" onClick={() => attach(c)} title={c.name} detail={c.phone || c.email} aside={`${c.loyalty_points} pts`} />)}</List>
                  )}
                </div>
              )}
              <Button variant="tint" size="sm" icon={UserPlus} className="mt-3" tid="cashier.new-customer" onClick={() => setEnrolling(true)}>New member</Button>
            </>
          )}
          {customer && customer.loyalty_points > 0 && (
            <Field label={`Redeem points (${customer.loyalty_points} available · 100 pts = AED 1)`}>
              <Input tid="cashier.redeem" type="number" min="0" max={customer.loyalty_points} inputMode="numeric" placeholder="0" value={redeem} onChange={(e) => setRedeem(e.target.value)} />
            </Field>
          )}
        </div>

        <div className="card">
          <div className="t-cap mb-2">Payment method</div>
          <div className="pay-grid">
            {PAYMENT_METHODS.map((m) => (
              <button key={m.id} type="button" data-tid="cashier.payment" className={`pay${method === m.id ? " is-active" : ""}`} aria-pressed={method === m.id} onClick={() => setMethod(m.id)}>
                <m.Icon size={19} aria-hidden="true" />{m.label}
              </button>
            ))}
          </div>
          {method === "cash" && (
            <Field label="Amount tendered (AED)">
              <Input tid="cashier.tendered" type="number" min="0" step="0.01" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder="0.00" />
            </Field>
          )}

          <div className="totals">
            <div className="row between"><span className="muted">Subtotal</span><span className="num">{aed(subtotal)}</span></div>
            {points > 0 && <div className="row between"><span className="muted">Points discount</span><span className="num">−{aed(points * POINTS_TO_AED)}</span></div>}
            <div className="row between totals__grand"><span>Total</span><span className="num">{aed(total)}</span></div>
            {method === "cash" && Number(tendered) > 0 && <div className="row between"><span className="muted">Change due</span><span className="num">{aed(Math.max(0, change))}</span></div>}
          </div>

          <Banner tone="error">{error}</Banner>
          {shortTender && cart.length > 0 && <p className="hint mb-2">Tendered amount is below the total due.</p>}
          <Button block size="lg" tid="cashier.complete" loading={busy} disabled={!canComplete} onClick={complete}>Complete sale · {aed(total)}</Button>
        </div>
      </div>

      <EnrollSheet open={enrolling} onClose={() => setEnrolling(false)} onEnrolled={(c) => { setEnrolling(false); attach(c); toast.show(`${c.name} enrolled`); }} />
    </div>
  );
}

function Directory() {
  const { token } = useSession();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      apiFetch(`/pos/customers${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`, { token })
        .then((r) => { if (!cancelled) setCustomers(r); })
        .catch((err) => { if (!cancelled) setError(err.message); });
    }, search ? 250 : 0);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search, token, enrolling]);

  function open(id) {
    setDetailBusy(true);
    setError("");
    apiFetch(`/pos/customers/${id}`, { token }).then(setSelected).catch((err) => setError(err.message)).finally(() => setDetailBusy(false));
  }

  if (selected) {
    return (
      <div>
        <Button variant="plain" size="sm" icon={ChevronLeft} tid="directory.back" onClick={() => setSelected(null)}>Back to directory</Button>
        <div className="card mt-3">
          <div className="row gap-3 mb-3">
            <Avatar name={selected.name} large />
            <div><div className="t-headline">{selected.name}</div><div className="t-sub">{selected.phone || "No phone on file"}{selected.email ? ` · ${selected.email}` : ""}</div><div className="mt-2"><Tag tone="green">{loyaltyTier(selected.loyalty_points)} · {selected.loyalty_points} pts</Tag></div></div>
          </div>
          <div className="row gap-2 wrap"><Tag>{plural(selected.total_orders, "order")}</Tag><Tag>Member since {fmtDate(selected.member_since)}</Tag></div>
        </div>
        <Section title="Order history">
          {(selected.orders ?? []).length === 0 ? <div className="card"><Empty icon={Receipt}>No orders yet.</Empty></div> : (
            <List>
              {selected.orders.map((o) => (
                <ListRow key={o.id} as="div" title={`${aed(o.total)} · ${plural(o.items.length, "item")}`}
                  detail={`${PAYMENT_LABEL[o.payment_method] || (o.channel === "self_checkout" ? "Self-checkout" : "—")}${o.cashier_name ? ` · rung up by ${o.cashier_name}` : ""} · ${fmtDate(o.created_at)}`} />
              ))}
            </List>
          )}
        </Section>
      </div>
    );
  }

  return (
    <div>
      <div className="row gap-2 mb-3">
        <div className="grow"><IconInput icon={Search} tid="directory.search" type="search" placeholder="Search by name, phone or email…" aria-label="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Button icon={UserPlus} tid="directory.new" onClick={() => setEnrolling(true)}>New</Button>
      </div>
      <Banner tone="error">{error}</Banner>
      {customers === null || detailBusy ? <CardSkeleton lines={4} /> : customers.length === 0 ? <div className="card"><Empty icon={Search}>No customers found.</Empty></div> : (
        <List>
          {customers.map((c) => (
            <ListRow key={c.id} tid="directory.open" onClick={() => open(c.id)} chevron
              title={c.name} detail={`${c.phone || "No phone"}${c.email ? ` · ${c.email}` : ""}`} aside={<Tag tone="green">{c.loyalty_points} pts</Tag>}>
              <span className="t-foot" style={{ display: "block" }}>{plural(c.total_orders, "order")}{c.last_order_at ? ` · last ${fmtDate(c.last_order_at)}` : ""}</span>
            </ListRow>
          ))}
        </List>
      )}
      <EnrollSheet open={enrolling} onClose={() => setEnrolling(false)} onEnrolled={(c) => { setEnrolling(false); setSelected(c); toast.show(`${c.name} enrolled`); }} />
    </div>
  );
}

export default function Cashier() {
  const { storeLabel } = useSession();
  const [tab, setTab] = useState("checkout");
  return (
    <div className="screen">
      <ScreenHeader title="Cashier" subtitle={`${storeLabel ? `${storeLabel} · ` : ""}Register`} />
      <Segmented options={[{ id: "checkout", label: "Checkout" }, { id: "customers", label: "Customers" }]} value={tab} tid="cashier.tab" label="Register section" onChange={setTab} className="mb-4" />
      {tab === "checkout" ? <Checkout /> : <Directory />}
    </div>
  );
}
