// IndexedDB persistence for the workspace, with a safe in-memory fallback (private windows,
// blocked storage, Node tests). Nothing here ever throws into the request path.

const DB_NAME = "retailmind";
const STORE = "kv";
const KEY = "workspace";
const CHANNEL = "retailmind-workspace";

const hasIdb = () => typeof indexedDB !== "undefined";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("IndexedDB blocked"));
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadState() {
  if (!hasIdb()) return null;
  try {
    return (await withStore("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function clearState() {
  if (!hasIdb()) return;
  try {
    await withStore("readwrite", (s) => s.delete(KEY));
  } catch { /* storage unavailable — nothing to clear */ }
}

/**
 * Write-behind: snapshots the workspace shortly after it changes (never on the request's own path —
 * a snapshot is ~1.4 MB), and tells other tabs so they can reload instead of overwriting each other.
 * Changes are coalesced for `delay` ms, but never held back longer than `maxWait`, and the page asks
 * for an immediate save when it is hidden or closed. `savedRevision` is what storage already holds,
 * so a write is skipped when there is nothing new to put.
 */
export function attachPersistence(db, { onExternalChange, delay = 150, maxWait = 1500, savedRevision = -1 } = {}) {
  if (!hasIdb()) return { flush: async () => {}, close() {} };

  const origin = Math.random().toString(36).slice(2);
  const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  let timer = null;
  let dirtySince = 0;
  let writing = Promise.resolve();

  const flush = () => {
    clearTimeout(timer);
    timer = null;
    dirtySince = 0;
    writing = writing.then(async () => {
      const revision = db.meta.revision;
      if (revision === savedRevision) return;
      try {
        await withStore("readwrite", (s) => s.put(db.snapshot(), KEY));
        savedRevision = revision;
        channel?.postMessage({ origin, revision });
      } catch { /* quota / blocked: keep running from memory */ }
    });
    return writing;
  };

  const off = db.onChange(() => {
    const now = Date.now();
    dirtySince ||= now;
    clearTimeout(timer);
    timer = setTimeout(flush, Math.max(0, Math.min(delay, dirtySince + maxWait - now)));
  });

  if (channel) {
    channel.onmessage = async (event) => {
      if (event.data?.origin === origin) return;
      const state = await loadState();
      if (state && state.meta.revision > db.meta.revision) {
        db.load(state);
        savedRevision = state.meta.revision;
        onExternalChange?.();
      }
    };
  }

  return {
    flush,
    close() {
      off();
      clearTimeout(timer);
      channel?.close();
    },
  };
}
