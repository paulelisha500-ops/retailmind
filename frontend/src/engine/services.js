// Stock fulfilment and supplier outreach — shared by the routes that need them.

/**
 * Decrements active batches of a product at a store, oldest-expiry first (FEFO), by up to
 * `quantity` units, and returns how many were actually taken. If recorded stock runs short the
 * sale still stands — the customer is already holding the item — and the gap is reported to the
 * caller, which records a stock-count task instead of pretending the sale didn't happen.
 */
export function consumeStock(db, storeId, productId, quantity) {
  if (quantity <= 0) return 0;
  let remaining = quantity;
  const lots = db
    .where("batches", (b) => b.product_id === productId && b.store_id === storeId && b.status === "active")
    .sort((a, b) => a.expires_at - b.expires_at);
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(lot.quantity, remaining);
    lot.quantity -= take;
    remaining -= take;
    if (lot.quantity <= 0) lot.status = "removed";
  }
  return quantity - remaining;
}

export function recordStockShortfall(db, storeId, productName, requested, consumed, now) {
  const title = `Stock count: ${productName}`;
  const detail = `Sold ${requested} but only ${consumed} on record — check the shelf and correct inventory`;
  const existing = db.where("tasks", (t) => t.store_id === storeId && t.title === title && !t.done)[0];
  if (existing) existing.detail = detail;
  else db.insert("tasks", { store_id: storeId, assigned_to: null, title, detail, source: "Stock count", done: false, created_at: now });
}

/**
 * Supplier outreach is always logged; nothing is dispatched unless a provider is connected, and
 * this workspace has none — so every contact is recorded with exactly what would have been sent.
 */
export function sendEmail() {
  return ["logged", "No email provider is connected to this workspace — logged only, nothing sent."];
}

export function placeCall() {
  return ["logged", "No voice-call provider is connected to this workspace — logged only, nothing dialed."];
}
