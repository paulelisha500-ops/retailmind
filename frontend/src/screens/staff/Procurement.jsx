import { Clock, FileUp, Mail, PackagePlus, Phone, Plus, Truck } from "lucide-react";
import { useState } from "react";
import { apiFetch } from "../../api.js";
import { CATEGORIES, COLD_CHAIN, ONBOARDING } from "../../lib/catalog.js";
import { aed, daysUntil, fmtDate, outreachLabel, plural } from "../../lib/format.js";
import { paths, useGlobalQuery, useStoreQuery } from "../../lib/hooks.js";
import { invalidate, setQuery, useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button, Field, Input, Segmented, Select } from "../../ui/controls.jsx";
import { Banner, CardSkeleton, Empty, List, ListRow, Meter, Section, Tag } from "../../ui/display.jsx";
import { ConfirmSheet, Sheet } from "../../ui/Sheet.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";
import { useToast } from "../../ui/Toast.jsx";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BLANK_SUPPLIER = { name: "", category: "Produce", contact_email: "", contact_phone: "", trade_license_no: "", trn: "", payment_terms: "Net 30", cold_chain: "ambient", onboarding_status: "pending" };
const BLANK_PRODUCT = { sku: "", name: "", category: "Produce", unit: "each", price: "", cost_price: "", reorder_threshold: "10", supplier_id: "" };
const statusLabel = (s) => (s || "pending").replace("_", " ");
const onboardingTone = (s) => (s === "approved" ? "green" : s === "suspended" ? "red" : s === "compliance_review" ? "amber" : "neutral");

/** A "Import CSV" button that opens the file picker and reports what was created, updated and skipped. */
function CsvImport({ endpoint, label, tid, onDone }) {
  const { token } = useSession();
  const [busy, setBusy] = useState(false);
  async function onFile(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      onDone(await apiFetch(endpoint, { method: "POST", token, formData: form }), null);
    } catch (err) { onDone(null, err.message); } finally { setBusy(false); }
  }
  return (
    <label className={`btn btn--gray${busy ? " is-busy" : ""}`} aria-label={label}>
      {busy ? <span className="spinner" aria-hidden="true" /> : <FileUp size={17} aria-hidden="true" />}
      {busy ? "Importing…" : "Import CSV"}
      <input type="file" accept=".csv,text/csv" hidden disabled={busy} data-tid={tid} onChange={onFile} />
    </label>
  );
}

const ImportResult = ({ result }) => result && (
  <Banner tone={result.errors.length ? "warn" : "success"}>
    Imported: {result.created} created, {result.updated} updated.{result.errors.length > 0 && ` ${plural(result.errors.length, "row issue")}: ${result.errors.slice(0, 3).join("; ")}`}
  </Banner>
);

export default function Procurement({ onNav }) {
  const { token, me, canApprove, activeStoreId } = useSession();
  const toast = useToast();
  const suppliers = useGlobalQuery("suppliers");
  const products = useGlobalQuery("products");
  const orders = useStoreQuery("orders");
  const [tab, setTab] = useState("orders");
  const [error, setError] = useState("");

  const reorder = useQuery(`/procurement/reorder-needed?store_id=${activeStoreId}`, { token, enabled: tab === "suppliers" && !!activeStoreId });
  const log = useQuery(`/procurement/contact-log?store_id=${activeStoreId}`, { token, enabled: tab === "suppliers" && !!activeStoreId });

  const supplierName = (id) => suppliers.data?.find((s) => s.id === id)?.name ?? "Unknown supplier";
  const productName = (id) => products.data?.find((p) => p.id === id)?.name ?? "item";
  const drafts = (orders.data ?? []).filter((o) => o.status === "draft");
  const history = (orders.data ?? []).filter((o) => o.status !== "draft");

  // ---- purchase orders ----
  async function decide(id, action) {
    setError("");
    try {
      const updated = await apiFetch(`/procurement/orders/${id}/${action}`, { method: "PATCH", token, body: { decided_by: me.id } });
      setQuery(paths.orders(activeStoreId), (prev = []) => prev.map((o) => (o.id === id ? updated : o)));
      toast.show(action === "approve" ? `${updated.po_number} approved` : `${updated.po_number} rejected`);
    } catch (err) { setError(err.message); }
  }

  // ---- supplier outreach ----
  const [notifying, setNotifying] = useState(null);
  async function notify(supplierId, productId, channel) {
    setNotifying(`${supplierId}-${productId}-${channel}`);
    setError("");
    try {
      await apiFetch(`/procurement/suppliers/${supplierId}/notify`, { method: "POST", token, body: { store_id: activeStoreId, channel, product_id: productId } });
      invalidate("/procurement/contact-log");
      toast.show(`${channel === "email" ? "Email" : "Call"} to ${supplierName(supplierId)} logged`);
    } catch (err) { setError(err.message); } finally { setNotifying(null); }
  }

  // ---- supplier form ----
  const [supplierForm, setSupplierForm] = useState(null); // null = closed; { id?, ...fields }
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [supplierImport, setSupplierImport] = useState(null);
  const [deleting, setDeleting] = useState(null); // { kind, row }
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openSupplier = (s) => {
    setSupplierError("");
    setSupplierForm(s ? { id: s.id, name: s.name, category: s.category, contact_email: s.contact_email || "", contact_phone: s.contact_phone || "", trade_license_no: s.trade_license_no || "", trn: s.trn || "", payment_terms: s.payment_terms || "Net 30", cold_chain: s.cold_chain || "ambient", onboarding_status: s.onboarding_status || "pending" } : { ...BLANK_SUPPLIER });
  };
  const setSup = (patch) => setSupplierForm((f) => ({ ...f, ...patch }));

  async function saveSupplier() {
    const { id, ...body } = supplierForm;
    if (!body.name.trim()) { setSupplierError("Enter the supplier's name."); return; }
    if (body.contact_email.trim() && !EMAIL_RE.test(body.contact_email.trim())) { setSupplierError("Contact email doesn't look like a valid email address."); return; }
    setSupplierSaving(true);
    setSupplierError("");
    try {
      await apiFetch(id ? `/procurement/suppliers/${id}` : "/procurement/suppliers", { method: id ? "PATCH" : "POST", token, body });
      invalidate(paths.suppliers);
      toast.show(id ? "Supplier updated" : `${body.name} added`);
      setSupplierForm(null);
    } catch (err) { setSupplierError(err.message); } finally { setSupplierSaving(false); }
  }

  // ---- product form ----
  const [productForm, setProductForm] = useState(null);
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");
  const [productImport, setProductImport] = useState(null);

  const openProduct = (p) => {
    setProductError("");
    setProductForm(p ? { id: p.id, sku: p.sku, name: p.name, category: p.category, unit: p.unit, price: String(p.price), cost_price: p.cost_price != null ? String(p.cost_price) : "", reorder_threshold: String(p.reorder_threshold), supplier_id: p.supplier_id || "" } : { ...BLANK_PRODUCT });
  };
  const setProd = (patch) => setProductForm((f) => ({ ...f, ...patch }));

  async function saveProduct() {
    const { id, ...form } = productForm;
    if (!form.name.trim() || !form.sku.trim()) { setProductError("SKU and name are required."); return; }
    const price = parseFloat(form.price);
    const cost = form.cost_price.trim() ? parseFloat(form.cost_price) : null;
    const threshold = form.reorder_threshold.trim() ? parseInt(form.reorder_threshold, 10) : 10;
    if (!Number.isFinite(price) || price <= 0) { setProductError("Price must be greater than 0."); return; }
    if (cost !== null && (!Number.isFinite(cost) || cost < 0)) { setProductError("Cost price can't be negative."); return; }
    if (!Number.isInteger(threshold) || threshold < 0) { setProductError("Reorder threshold must be 0 or more."); return; }
    setProductSaving(true);
    setProductError("");
    const payload = { ...form, price, cost_price: cost, reorder_threshold: threshold, supplier_id: form.supplier_id || null };
    try {
      if (id) { const { sku: _sku, ...updatable } = payload; await apiFetch(`/inventory/products/${id}`, { method: "PATCH", token, body: updatable }); }
      else await apiFetch("/inventory/products", { method: "POST", token, body: payload });
      invalidate(paths.products);
      toast.show(id ? "Product updated" : `${form.name} added`);
      setProductForm(null);
    } catch (err) { setProductError(err.message); } finally { setProductSaving(false); }
  }

  async function confirmDelete() {
    setDeleteBusy(true);
    setError("");
    const { kind, row } = deleting;
    try {
      await apiFetch(`${kind === "supplier" ? "/procurement/suppliers" : "/inventory/products"}/${row.id}`, { method: "DELETE", token });
      invalidate(kind === "supplier" ? paths.suppliers : paths.products);
      toast.show(`${row.name} deleted`);
    } catch (err) { setError(err.message); } finally { setDeleteBusy(false); setDeleting(null); }
  }

  const itemsSummary = (o) => (o.items.length ? o.items.map((it) => `${it.quantity}× ${productName(it.product_id)}`).join(" + ") : "No line items");
  const sourceSummary = (o) => (o.forecast_confidence != null ? `${o.created_from} · ${Math.round(o.forecast_confidence * 100)}% confidence` : o.created_from);
  const loading = orders.loading || suppliers.loading;

  return (
    <div className="screen">
      <ScreenHeader title="Procurement" subtitle={`${plural(drafts.length, "order")} awaiting approval`} back={{ label: "Home", tid: "procurement.back", onClick: () => onNav("home") }} />
      <Segmented options={[{ id: "orders", label: "Orders" }, { id: "suppliers", label: "Suppliers" }, { id: "products", label: "Products" }]} value={tab} tid="procurement.tab" label="Procurement section" onChange={setTab} className="mb-4" />
      <Banner tone="error">{error}</Banner>

      {tab === "orders" && (loading ? <CardSkeleton lines={4} /> : (
        <>
          <Section title="Awaiting approval">
            {drafts.length === 0 ? <div className="card"><Empty icon={Truck}>No drafts waiting — all caught up.</Empty></div> : (
              <div className="stack gap-3">
                {drafts.map((o) => (
                  <article key={o.id} className="card po">
                    <div className="row between"><span className="t-cap">{o.po_number}</span><b className="num">{aed(o.total_cost, 0)}</b></div>
                    <div className="t-headline mt-1">{supplierName(o.supplier_id)}</div>
                    <div className="t-sub mb-2">{itemsSummary(o)}</div>
                    <div className="t-foot row gap-1 mb-3"><Clock size={12} aria-hidden="true" />Need by {fmtDate(o.need_by)} · {sourceSummary(o)}</div>
                    {canApprove ? (
                      <div className="row gap-2"><Button variant="danger" size="sm" tid="procurement.reject" onClick={() => decide(o.id, "reject")}>Reject</Button><Button size="sm" tid="procurement.approve" onClick={() => decide(o.id, "approve")}>Approve</Button></div>
                    ) : <Tag tone="amber">Pending admin approval</Tag>}
                  </article>
                ))}
              </div>
            )}
          </Section>
          <Section title="History">
            {history.length === 0 ? <div className="card"><Empty>No history yet.</Empty></div> : (
              <List>
                {history.map((o) => (
                  <ListRow key={o.id} as="div">
                    <span className="list-row__main">
                      <span className="row between"><span className="list-row__title">{supplierName(o.supplier_id)}</span><span className="num">{aed(o.total_cost, 0)}</span></span>
                      <span className="list-row__detail" style={{ display: "block" }}>{o.po_number} · {itemsSummary(o)}</span>
                      <span style={{ display: "block", marginTop: 6 }}><Tag tone={o.status === "approved" ? "blue" : o.status === "rejected" ? "red" : "green"}>{o.status === "approved" ? "Sent to supplier" : o.status === "rejected" ? "Rejected" : "Delivered"}</Tag></span>
                    </span>
                  </ListRow>
                ))}
              </List>
            )}
          </Section>
        </>
      ))}

      {tab === "suppliers" && (
        <>
          {reorder.data?.length > 0 && (
            <Section title={`Needs reordering (${reorder.data.length})`}>
              <div className="stack gap-3">
                {reorder.data.map((r) => (
                  <article key={r.product_id} className="card">
                    <div className="row between gap-3">
                      <div className="grow"><div className="t-headline">{r.product_name}</div><div className="t-foot">{r.current_stock} on hand · reorder point {r.reorder_threshold} · {r.supplier_name || "no supplier assigned"}</div></div>
                      <Tag tone={r.current_stock === 0 ? "red" : "amber"}>{r.current_stock === 0 ? "Stockout" : "Low"}</Tag>
                    </div>
                    {r.supplier_id && (
                      <div className="row gap-2 mt-3">
                        <Button variant="tint" size="sm" icon={Mail} tid="procurement.notify-email" loading={notifying === `${r.supplier_id}-${r.product_id}-email`} onClick={() => notify(r.supplier_id, r.product_id, "email")}>Email</Button>
                        <Button variant="tint" size="sm" icon={Phone} tid="procurement.notify-call" loading={notifying === `${r.supplier_id}-${r.product_id}-call`} onClick={() => notify(r.supplier_id, r.product_id, "call")}>Call</Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </Section>
          )}

          <Section title={plural(suppliers.data?.length ?? 0, "supplier")}>
            <div className="row gap-2 mb-3"><Button icon={Plus} tid="procurement.add-supplier" onClick={() => openSupplier(null)}>Add supplier</Button>
              <CsvImport endpoint="/procurement/suppliers/import" label="Import suppliers from a CSV file" tid="procurement.import-suppliers" onDone={(r, e) => { setSupplierImport(r); if (e) setError(e); else { setError(""); invalidate(paths.suppliers); } }} /></div>
            <p className="hint mb-3">Required columns: name, category. Optional: contact_email, contact_phone, trade_license_no, trn, payment_terms, cold_chain, onboarding_status, performance_score, on_time_pct, late_deliveries_30d. Existing suppliers are matched by name.</p>
            <ImportResult result={supplierImport} />
            {suppliers.loading ? <CardSkeleton lines={4} /> : (
              <div className="stack gap-3">
                {suppliers.data.map((s) => {
                  const renew = daysUntil(s.contract_end);
                  return (
                    <article key={s.id} className="card">
                      <div className="row between gap-3 mb-2">
                        <div className="grow">
                          <div className="t-headline">{s.name}</div>
                          <div className="t-foot">{s.category}{s.contact_email ? ` · ${s.contact_email}` : ""}</div>
                          {(s.trade_license_no || s.trn) && <div className="t-foot">{s.trade_license_no ? `Licence ${s.trade_license_no}` : ""}{s.trade_license_no && s.trn ? " · " : ""}{s.trn ? `TRN ${s.trn}` : ""}</div>}
                        </div>
                        <div className="score"><b>{s.performance_score}</b><span>score</span></div>
                      </div>
                      <Meter pct={s.performance_score} />
                      <div className="row gap-2 wrap mt-3">
                        <Tag tone={onboardingTone(s.onboarding_status)}>{statusLabel(s.onboarding_status)}</Tag>
                        <Tag tone={s.on_time_pct >= 95 ? "green" : s.on_time_pct >= 88 ? "amber" : "red"}>{Math.round(s.on_time_pct)}% on-time</Tag>
                        {s.late_deliveries_30d > 0 && <Tag tone="red">{s.late_deliveries_30d} late this month</Tag>}
                        {renew != null && renew <= 30 && <Tag tone="amber">Renews in {renew}d</Tag>}
                        {s.cold_chain && s.cold_chain !== "ambient" && <Tag>{s.cold_chain}</Tag>}
                        {s.payment_terms && <Tag>{s.payment_terms}</Tag>}
                      </div>
                      <div className="row gap-2 mt-3"><Button variant="gray" size="sm" tid="procurement.edit-supplier" onClick={() => openSupplier(s)}>Edit</Button><Button variant="danger" size="sm" tid="procurement.delete-supplier" onClick={() => setDeleting({ kind: "supplier", row: s })}>Delete</Button></div>
                    </article>
                  );
                })}
                {suppliers.data.length === 0 && <div className="card"><Empty>No suppliers on file.</Empty></div>}
              </div>
            )}
          </Section>

          {log.data?.length > 0 && (
            <Section title="Outreach log">
              <List>
                {log.data.map((c) => (
                  <ListRow key={c.id} as="div">
                    <span className="list-row__main">
                      <span className="list-row__title row gap-2">{c.channel === "email" ? <Mail size={14} aria-hidden="true" /> : <Phone size={14} aria-hidden="true" />}{supplierName(c.supplier_id)}<Tag tone={c.status === "sent" ? "green" : c.status === "failed" ? "red" : "neutral"}>{outreachLabel[c.status] ?? c.status}</Tag></span>
                      <span className="list-row__detail" style={{ display: "block" }}>{c.message}</span>
                    </span>
                  </ListRow>
                ))}
              </List>
            </Section>
          )}
        </>
      )}

      {tab === "products" && (
        <Section title={plural(products.data?.length ?? 0, "product")}>
          <div className="row gap-2 mb-3"><Button icon={PackagePlus} tid="procurement.add-product" onClick={() => openProduct(null)}>Add product</Button>
            <CsvImport endpoint="/inventory/products/import" label="Import products from a CSV file" tid="procurement.import-products" onDone={(r, e) => { setProductImport(r); if (e) setError(e); else { setError(""); invalidate(paths.products); } }} /></div>
          <p className="hint mb-3">Import from a Google Sheet: File → Download → Comma-separated values (.csv). Required columns: sku, name, category, price. Optional: barcode, unit, cost_price, reorder_threshold, supplier_name, allergens, dietary_tags (semicolon-separated). Cost price is the landed unit cost — it drives real margin in Analytics → Profit &amp; Loss.</p>
          <ImportResult result={productImport} />
          {products.loading ? <CardSkeleton lines={4} /> : (
            <List>
              {products.data.map((p) => (
                <ListRow key={p.id} as="div">
                  <span className="list-row__main">
                    <span className="list-row__title">{p.name}</span>
                    <span className="list-row__detail" style={{ display: "block" }}>{p.sku} · {p.category} · {aed(p.price)} · reorder at {p.reorder_threshold}{p.cost_price != null ? ` · ${Math.round((1 - p.cost_price / p.price) * 100)}% margin` : " · no cost on file"}</span>
                  </span>
                  <Button variant="gray" size="sm" tid="procurement.edit-product" onClick={() => openProduct(p)}>Edit</Button>
                  <Button variant="danger" size="sm" tid="procurement.delete-product" onClick={() => setDeleting({ kind: "product", row: p })}>Delete</Button>
                </ListRow>
              ))}
              {products.data.length === 0 && <Empty>No products yet.</Empty>}
            </List>
          )}
        </Section>
      )}

      <Sheet open={!!supplierForm} onClose={() => setSupplierForm(null)} title={supplierForm?.id ? "Edit supplier" : "Add supplier"} tid="procurement.supplier-form"
        actions={<><Button variant="gray" tid="procurement.supplier-form.cancel" onClick={() => setSupplierForm(null)}>Cancel</Button><Button tid="procurement.supplier-form.save" loading={supplierSaving} onClick={saveSupplier}>{supplierForm?.id ? "Save changes" : "Add supplier"}</Button></>}>
        {supplierForm && (
          <>
            <Banner tone="error">{supplierError}</Banner>
            <Field label="Supplier name"><Input tid="procurement.supplier-form.name" value={supplierForm.name} onChange={(e) => setSup({ name: e.target.value })} placeholder="Supplier name" /></Field>
            <Field label="Category" hint="Pick one or type a new section">
              <Input tid="procurement.supplier-form.category" list="rm-categories" value={supplierForm.category} onChange={(e) => setSup({ category: e.target.value })} />
              <datalist id="rm-categories">{CATEGORIES.map((c) => <option key={c.id} value={c.id} />)}</datalist>
            </Field>
            <Field label="Contact email"><Input tid="procurement.supplier-form.email" type="email" value={supplierForm.contact_email} onChange={(e) => setSup({ contact_email: e.target.value })} placeholder="orders@supplier.com" /></Field>
            <Field label="Contact phone"><Input tid="procurement.supplier-form.phone" value={supplierForm.contact_phone} onChange={(e) => setSup({ contact_phone: e.target.value })} placeholder="+971 …" /></Field>
            <Field label="Trade licence no."><Input tid="procurement.supplier-form.licence" value={supplierForm.trade_license_no} onChange={(e) => setSup({ trade_license_no: e.target.value })} /></Field>
            <Field label="TRN (tax registration number)"><Input tid="procurement.supplier-form.trn" value={supplierForm.trn} onChange={(e) => setSup({ trn: e.target.value })} /></Field>
            <Field label="Payment terms"><Input tid="procurement.supplier-form.terms" value={supplierForm.payment_terms} onChange={(e) => setSup({ payment_terms: e.target.value })} placeholder="e.g. Net 30" /></Field>
            <Field label="Cold chain"><Segmented options={COLD_CHAIN.map((c) => ({ id: c, label: c }))} value={supplierForm.cold_chain} tid="procurement.supplier-form.cold-chain" label="Cold chain" size="sm" onChange={(v) => setSup({ cold_chain: v })} /></Field>
            <Field label="Onboarding status"><Select tid="procurement.supplier-form.status" value={supplierForm.onboarding_status} onChange={(e) => setSup({ onboarding_status: e.target.value })}>{ONBOARDING.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</Select></Field>
          </>
        )}
      </Sheet>

      <Sheet open={!!productForm} onClose={() => setProductForm(null)} title={productForm?.id ? "Edit product" : "Add product"} tid="procurement.product-form"
        actions={<><Button variant="gray" tid="procurement.product-form.cancel" onClick={() => setProductForm(null)}>Cancel</Button><Button tid="procurement.product-form.save" loading={productSaving} onClick={saveProduct}>{productForm?.id ? "Save changes" : "Add product"}</Button></>}>
        {productForm && (
          <>
            <Banner tone="error">{productError}</Banner>
            <Field label="SKU"><Input tid="procurement.product-form.sku" value={productForm.sku} disabled={!!productForm.id} onChange={(e) => setProd({ sku: e.target.value })} placeholder="SKU" /></Field>
            <Field label="Product name"><Input tid="procurement.product-form.name" value={productForm.name} onChange={(e) => setProd({ name: e.target.value })} placeholder="Product name" /></Field>
            <Field label="Category" hint="Pick one or type a new section">
              <Input tid="procurement.product-form.category" list="rm-categories" value={productForm.category} onChange={(e) => setProd({ category: e.target.value })} />
            </Field>
            <Field label="Unit"><Input tid="procurement.product-form.unit" value={productForm.unit} onChange={(e) => setProd({ unit: e.target.value })} placeholder="each, kg, L…" /></Field>
            <Field label="Price (AED)"><Input tid="procurement.product-form.price" type="number" min="0" step="0.01" inputMode="decimal" value={productForm.price} onChange={(e) => setProd({ price: e.target.value })} /></Field>
            <Field label="Cost price (AED)" hint="The landed unit cost — drives real margin in Analytics → Profit & Loss."><Input tid="procurement.product-form.cost" type="number" min="0" step="0.01" inputMode="decimal" value={productForm.cost_price} onChange={(e) => setProd({ cost_price: e.target.value })} /></Field>
            <Field label="Reorder threshold"><Input tid="procurement.product-form.threshold" type="number" min="0" inputMode="numeric" value={productForm.reorder_threshold} onChange={(e) => setProd({ reorder_threshold: e.target.value })} /></Field>
            <Field label="Supplier">
              <Select tid="procurement.product-form.supplier" value={productForm.supplier_id} onChange={(e) => setProd({ supplier_id: e.target.value })}>
                <option value="">No supplier assigned</option>
                {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          </>
        )}
      </Sheet>

      <ConfirmSheet open={!!deleting} onClose={() => setDeleting(null)} onConfirm={confirmDelete} busy={deleteBusy} tid="procurement.delete-confirm"
        title={`Delete ${deleting?.kind ?? ""}?`} message={deleting ? `${deleting.row.name} will be removed. Records that still reference it can't be deleted.` : ""} confirmLabel="Delete" />
    </div>
  );
}
