// A tiny stale-while-revalidate cache. Screens read through `useQuery`, so switching tabs shows the
// last result instantly while a fresh one loads, and a mutation can patch or invalidate what's shown.
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { apiFetch } from "../api.js";

const entries = new Map(); // key -> { data, error, at, promise, version, again }
const listeners = new Map(); // key -> Set<fn>
const fetchers = new Map(); // key -> Set<() => Promise> — how to re-read each query that is on screen right now
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
  if (entry?.promise) {
    // A request is already out. If this one was forced (a mutation just landed), what's coming back may
    // predate it, so read once more when it does rather than letting the older answer stand.
    if (force) entry.again = true;
    return entry.promise;
  }
  if (!force && entry?.at && Date.now() - entry.at < STALE_MS) return Promise.resolve(entry.data);

  const promise = fetcher().then(
    (data) => {
      const again = entries.get(key)?.again;
      entries.set(key, { data, error: null, at: Date.now(), promise: null, version: (entries.get(key)?.version ?? 0) + 1 });
      notify(key);
      if (again) load(key, fetcher, { force: true }).catch(() => {});
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
    const run = () => fetcherRef.current();
    if (!fetchers.has(key)) fetchers.set(key, new Set());
    fetchers.get(key).add(run);
    load(key, run).catch(() => {});
    const id = refetchMs ? setInterval(() => load(key, run, { force: true }).catch(() => {}), refetchMs) : null;
    return () => {
      clearInterval(id);
      fetchers.get(key)?.delete(run);
    };
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

/**
 * Shows a change instantly, then confirms it: `updater` is applied to what's cached for `path` right away,
 * then `request` runs. If it fails the previous data is put back and the error is rethrown, so a control
 * never sits waiting on the round trip but never keeps a change that didn't happen either.
 */
export async function optimistic(path, updater, request) {
  const before = entries.get(path)?.data;
  setQuery(path, updater);
  try {
    return await request();
  } catch (error) {
    setQuery(path, before);
    throw error;
  }
}

/**
 * Mark everything whose path starts with `prefix` stale, and re-read what is on screen right now (the old
 * data stays visible until the new arrives). Anything not showing is simply re-read next time it opens.
 */
export function invalidate(prefix) {
  for (const key of [...entries.keys()]) {
    if (!key.startsWith(prefix)) continue;
    entries.set(key, { ...entries.get(key), at: 0 });
    const run = fetchers.get(key)?.values().next().value;
    if (run) load(key, run, { force: true }).catch(() => {});
  }
}

export function clearQueries() {
  entries.clear();
  for (const key of listeners.keys()) notify(key);
}
