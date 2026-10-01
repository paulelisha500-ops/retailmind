// Who is signed in, which store they're looking at, and the actions that change either.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, UNAUTHORIZED_EVENT, apiFetch } from "./api.js";
import { clearQueries, setQuery, useQuery } from "./lib/query.js";

const TOKEN_KEY = "retailmind_token";
const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);

const storage = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (value) => { try { localStorage.setItem(TOKEN_KEY, value); } catch { /* private window: stay signed in for this tab only */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing stored */ } },
};

/**
 * Reads the profile together with the store list and puts the stores in the cache, so the first screen
 * paints once with its store name instead of shifting when that arrives a moment later.
 */
async function loadSession(token) {
  const [profile, stores] = await Promise.all([apiFetch("/auth/me", { token }), apiFetch("/stores", { token }).catch(() => null)]);
  if (stores) setQuery("/stores", stores);
  return profile;
}

export function SessionProvider({ children }) {
  const [token, setToken] = useState(storage.get);
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(!!storage.get());
  const [notice, setNotice] = useState("");
  const [storeMode, setStoreMode] = useState("single"); // single | enterprise (admins)
  const [chosenStoreId, setActiveStoreId] = useState(null);

  const isEmployee = me?.role === "employee";
  const isAdmin = me?.access_level === "admin";

  // Restore a saved session on load.
  useEffect(() => {
    if (!token) return undefined;
    let cancelled = false;
    loadSession(token)
      .then((profile) => { if (!cancelled) setMe(profile); })
      .catch((err) => { if (err instanceof ApiError && err.status === 401) { storage.clear(); setToken(null); } })
      .finally(() => { if (!cancelled) setBooting(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on first load; login sets `me` itself
  }, []);

  const signOut = useCallback((message = "") => {
    storage.clear();
    clearQueries();
    setToken(null);
    setMe(null);
    setActiveStoreId(null);
    setStoreMode("single");
    setNotice(message);
  }, []);

  // A 401 on any authenticated call means the session expired or was reset.
  useEffect(() => {
    const onExpired = () => { if (me) signOut("Your session ended — please sign in again."); };
    window.addEventListener(UNAUTHORIZED_EVENT, onExpired);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onExpired);
  }, [me, signOut]);

  const signIn = useCallback(async (email, password) => {
    const res = await apiFetch("/auth/login", { method: "POST", body: { email, password } });
    const profile = await loadSession(res.access_token);
    storage.set(res.access_token);
    setNotice("");
    setToken(res.access_token);
    setMe(profile);
    return profile;
  }, []);

  const refreshMe = useCallback(async () => {
    if (!token) return;
    try { setMe(await apiFetch("/auth/me", { token })); } catch { /* the next successful call catches up */ }
  }, [token]);

  const { data: stores = [] } = useQuery("/stores", { token, enabled: !!me });

  // Employees start in their own store; admins can switch (enterprise mode).
  const activeStoreId = chosenStoreId ?? (isEmployee ? me?.store_id ?? null : null);
  const activeStore = stores.find((s) => s.id === activeStoreId) ?? null;
  const customerStoreId = me?.preferred_store_id || stores.find((s) => s.is_headquarters)?.id || stores[0]?.id || null;

  const value = useMemo(() => ({
    token, me, setMe, booting, notice, setNotice, signIn, signOut, refreshMe, stores, isEmployee, isAdmin,
    storeMode, setStoreMode, activeStoreId, setActiveStoreId, activeStore,
    storeLabel: activeStore ? `${activeStore.name} ${activeStore.code}` : "",
    customerStoreId,
    canApprove: isAdmin || (me?.responsibilities ?? []).includes("Purchase Approvals"),
  }), [token, me, booting, notice, signIn, signOut, refreshMe, stores, isEmployee, isAdmin, storeMode, activeStoreId, activeStore, customerStoreId]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
