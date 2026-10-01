import { useCallback, useEffect, useState } from "react";
import { useSession } from "../session.jsx";
import { useQuery } from "./query.js";

/** Store-scoped and global data, all read through the shared cache. */
export const paths = {
  tasks: (storeId) => `/tasks?store_id=${storeId}`,
  alerts: (storeId) => `/alerts?store_id=${storeId}`,
  orders: (storeId) => `/procurement/orders?store_id=${storeId}`,
  team: (storeId) => `/team?store_id=${storeId}`,
  suppliers: "/procurement/suppliers",
  products: "/inventory/products",
};

export function useStoreQuery(kind, options = {}) {
  const { token, activeStoreId } = useSession();
  return useQuery(paths[kind](activeStoreId), { token, enabled: !!activeStoreId, ...options });
}

export function useGlobalQuery(kind, options = {}) {
  const { token, isEmployee } = useSession();
  return useQuery(paths[kind], { token, enabled: isEmployee, ...options });
}

export function useMediaQuery(query) {
  const get = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Hash-based routing: deep links and the browser's back button work on any static host. */
export function useHashRoute() {
  const read = () => (typeof window === "undefined" ? "/" : window.location.hash.replace(/^#/, "") || "/");
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onChange = () => setPath(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next, { replace = false } = {}) => {
    const hash = `#${next}`;
    if (replace) window.history.replaceState(null, "", hash);
    else if (window.location.hash !== hash) window.location.hash = hash;
    setPath(next);
  }, []);
  return [path, navigate];
}
