import { ScanLine, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { apiFetch } from "../../api.js";
import { aed } from "../../lib/format.js";
import { invalidate } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button, IconInput } from "../../ui/controls.jsx";
import { Banner, CategoryIcon, Empty, List, ListRow, Tag } from "../../ui/display.jsx";
import { Sheet } from "../../ui/Sheet.jsx";
import { useToast } from "../../ui/Toast.jsx";

/** Search the catalogue by name or barcode; see nutrition and allergens; add to the shopping list. */
export default function FindProduct({ open, onClose, onAdded }) {
  const { token } = useSession();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setQuery(""); setResults([]); setSelected(null); setError(""); };
  const close = () => { reset(); onClose(); };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return undefined;
    let cancelled = false;
    const param = /^\d{6,}$/.test(q) ? `barcode=${encodeURIComponent(q)}` : `search=${encodeURIComponent(q)}`;
    apiFetch(`/customer/products?${param}`, { token }).then((res) => { if (!cancelled) setResults(res); }).catch(() => {});
    return () => { cancelled = true; };
  }, [query, token]);

  async function add() {
    setAdding(true);
    setError("");
    try {
      await apiFetch("/customer/shopping-list", { method: "POST", token, body: { product_id: selected.id, quantity: 1 } });
      invalidate("/customer/shopping-list");
      toast.show(`${selected.name} added to your list`);
      reset();
      onAdded?.();
    } catch (err) {
      setError(err.message || "Couldn't add to list");
    } finally {
      setAdding(false);
    }
  }

  const n = selected?.nutrition ?? {};
  const shown = query.trim().length < 2 ? [] : results;

  return (
    <Sheet open={open} onClose={close} title={selected ? selected.name : "Find a product"} tid="find-product"
      actions={selected ? (
        <>
          <Button variant="gray" tid="find-product.back" onClick={() => setSelected(null)}>Back to search</Button>
          <Button tid="find-product.add" loading={adding} onClick={add}>Add to list</Button>
        </>
      ) : null}>
      {!selected && (
        <>
          <p className="t-sub mb-3">Search by name or barcode.</p>
          <IconInput icon={Search} tid="find-product.search" type="search" placeholder="Search products…" aria-label="Search products" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
          <div className="mt-3">
            {shown.length > 0 && (
              <List>
                {shown.map((p) => (
                  <ListRow key={p.id} tid="find-product.result" onClick={() => setSelected(p)} title={p.name} detail={p.category} aside={aed(p.price)} chevron />
                ))}
              </List>
            )}
            {query.trim().length >= 2 && shown.length === 0 && <Empty icon={Search}>No products match “{query.trim()}”.</Empty>}
            {query.trim().length < 2 && <Empty icon={ScanLine}>Type at least two characters to search.</Empty>}
          </div>
        </>
      )}

      {selected && (
        <div className="stack gap-3">
          <div className="row gap-3">
            <span className="reco__icon reco__icon--lg"><CategoryIcon category={selected.category} size={22} aria-hidden="true" /></span>
            <div><div className="t-headline">{aed(selected.price)} <span className="t-sub">/ {selected.unit}</span></div><div className="t-sub">{selected.category}</div></div>
          </div>
          <div className="row gap-2 wrap">
            {selected.dietary_tags.map((t) => <Tag key={t} tone="green">{t}</Tag>)}
            {selected.allergens.map((a) => <Tag key={a} tone="amber">Contains {a}</Tag>)}
          </div>
          {Object.keys(n).length > 0 && (
            <div className="nutri">
              {n.kcal != null && <div><b>{n.kcal}</b><span>kcal</span></div>}
              {n.carbs_g != null && <div><b>{n.carbs_g}g</b><span>carbs</span></div>}
              {n.protein_g != null && <div><b>{n.protein_g}g</b><span>protein</span></div>}
              {n.fat_g != null && <div><b>{n.fat_g}g</b><span>fat</span></div>}
            </div>
          )}
          <Banner tone="error">{error}</Banner>
        </div>
      )}
    </Sheet>
  );
}
