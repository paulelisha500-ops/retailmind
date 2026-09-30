// A tiny stale-while-revalidate cache. Screens read through `useQuery`, so switching tabs shows the
// last result instantly while a fresh one loads, and a mutation can patch or invalidate what's shown.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { apiFetch } from "../api.js";

const entries = new Map(); // key -> { data, error, at, promise, version }
const listeners = new Map(); // key -> Set<fn>
const STALE_MS = 15_000;

const notify = (key) => listeners.get(key)?.forEach((fn) => fn());

function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key)?.delete(fn);
}

const snapshot = (key) => entries.get(key);

function load(key, fetcher, { force = false } = {}) {
  const entry = entries.get(key);
  if (entry?.promise) return entry.promise;
  if (!force && entry?.at && Date.now() - entry.at < STALE_MS) return Promise.resolve(entry.data);

  const promise = fetcher().then(
    (data) => {
      entries.set(key, { data, error: null, at: Date.now(), promise: null, version: (entries.get(key)?.version ?? 0) + 1 });
      notify(key);
      return data;
    },
    (error) => {
      entries.set(key, { data: entry?.data, error, at: 0, promise: null, version: (entries.get(key)?.version ?? 0) + 1 });
      notify(key);
      throw error;
    },
  );
  entries.set(key, { ...(entry ?? { data: undefined, error: null, at: 0 }), promise, version: entry?.version ?? 0 });
  return promise;
}

/** Reads `path` through the cache. `data` is undefined until the first response. */
export function useQuery(path, { token, enabled = true, refetchMs = 0 } = {}) {
  const key = path;
  const fetcher = useCallback(() => apiFetch(path, { token }), [path, token]);
  const fetcherRef = useRef(fetcher);
  useEffect(() => { fetcherRef.current = fetcher; });

  const entry = useSyncExternalStore((fn) => subscribe(key, fn), () => snapshot(key), () => undefined);

  useEffect(() => {
    if (!enabled || !path) return undefined;
    load(key, () => fetcherRef.current()).catch(() => {});
    if (!refetchMs) return undefined;
    const id = setInterval(() => load(key, () => fetcherRef.current(), { force: true }).catch(() => {}), refetchMs);
    return () => clearInterval(id);
  }, [key, enabled, path, refetchMs]);

  const refetch = useCallback(() => load(key, () => fetcherRef.current(), { force: true }), [key]);
  return {
    data: entry?.data,
    error: entry?.error ?? null,
    loading: enabled && !!path && entry?.data === undefined && !entry?.error,
    refreshing: !!entry?.promise,
    refetch,
  };
}

/** Replace (or patch via an updater) what's cached for a path, e.g. after a successful mutation. */
export function setQuery(path, valueOrUpdater) {
  const entry = entries.get(path);
  const data = typeof valueOrUpdater === "function" ? valueOrUpdater(entry?.data) : valueOrUpdater;
  entries.set(path, { data, error: null, at: Date.now(), promise: null, version: (entry?.version ?? 0) + 1 });
  notify(path);
}

/** Mark everything whose path starts with `prefix` stale and refetch what's currently on screen. */
export function invalidate(prefix) {
  for (const key of entries.keys()) {
    if (!key.startsWith(prefix)) continue;
    const entry = entries.get(key);
    entries.set(key, { ...entry, at: 0 });
    if (listeners.get(key)?.size) notify(key);
  }
}

export function clearQueries() {
  entries.clear();
  for (const key of listeners.keys()) notify(key);
}
