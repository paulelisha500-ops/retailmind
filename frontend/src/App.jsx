import { Leaf, LogOut, RefreshCw } from "lucide-react";
import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { ADMIN_TABS, CUSTOMER_TABS, STAFF_TABS } from "./lib/catalog.js";
import { useHashRoute } from "./lib/hooks.js";
import Landing from "./screens/Landing.jsx";
import SignIn from "./screens/SignIn.jsx";
import { SessionProvider, useSession } from "./session.jsx";
import { ToastProvider, useToast } from "./ui/Toast.jsx";
import { Button } from "./ui/controls.jsx";
import { Avatar, Banner, Skeleton } from "./ui/display.jsx";

// Every signed-in screen is its own chunk, fetched on demand and warmed while the browser is idle. React.lazy suspends
// on its first render even when the chunk is already here, and React 19 then keeps the fallback up for at least 300 ms,
// so a screen whose chunk has arrived renders directly and only one that is still on its way goes through lazy.
function screen(load) {
  const entry = { Component: null };
  entry.load = () => load().then((module) => { entry.Component = module.default; return module; });
  entry.Lazy = lazy(entry.load);
  return entry;
}

const screens = {
  home: { customer: screen(() => import("./screens/customer/Home.jsx")), staff: screen(() => import("./screens/staff/Home.jsx")) },
  list: screen(() => import("./screens/customer/List.jsx")),
  offers: screen(() => import("./screens/customer/Offers.jsx")),
  profile: screen(() => import("./screens/Profile.jsx")),
  cashier: screen(() => import("./screens/staff/Cashier.jsx")),
  tasks: screen(() => import("./screens/staff/Tasks.jsx")),
  monitoring: screen(() => import("./screens/staff/Monitoring.jsx")),
  forecast: screen(() => import("./screens/staff/Forecast.jsx")),
  procurement: screen(() => import("./screens/staff/Procurement.jsx")),
  assistant: screen(() => import("./screens/staff/Assistant.jsx")),
  warehouse: screen(() => import("./screens/staff/Warehouse.jsx")),
  analytics: screen(() => import("./screens/staff/Analytics.jsx")),
  team: screen(() => import("./screens/staff/Team.jsx")),
};

const CUSTOMER_SCREENS = ["home", "list", "offers", "profile"];
const STAFF_SCREENS = ["home", "cashier", "tasks", "monitoring", "forecast", "procurement", "assistant", "warehouse", "profile"];
const ADMIN_ONLY = ["analytics", "team"];

/** Starts fetching the chunks for these screens now. A failure is left for the visit itself to retry and report. */
function preload(ids) {
  for (const id of ids) {
    const s = screens[id];
    if (s) (s.load ? [s] : Object.values(s)).forEach((entry) => entry.load().catch(() => {}));
  }
}

function warmScreens(ids) {
  const run = () => preload(ids);
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 2500 }); else setTimeout(run, 1200);
}

// Which component a visit renders is settled when the screen opens, so a chunk arriving while it is open never swaps
// the screen (and whatever is half-done on it) out from under the person using it.
function ScreenView({ entry, ...props }) {
  const [View] = useState(() => entry.Component ?? entry.Lazy);
  return <View {...props} />;
}

// A screen that fails to load or render shows a way out instead of a blank page. The usual cause is a new version
// published while this tab was open: the old copy of a screen it hadn't opened yet is no longer on the server.
class ScreenBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen screen--narrow">
        <header className="screen-head"><h1 className="t-large">This screen didn&rsquo;t open</h1></header>
        <Banner tone="error">RetailMind may have been updated since this tab was opened. Reload to get the latest version.</Banner>
        <Button tid="app.reload-screen" icon={RefreshCw} onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}

function ScreenFallback() {
  return (
    <div className="screen" aria-busy="true">
      <div className="skeleton" style={{ width: 190, height: 34, marginBottom: 26 }} />
      <Skeleton lines={2} block />
    </div>
  );
}

function Shell({ screenId, navigate }) {
  const { me, isEmployee, isAdmin, signOut } = useSession();
  const mainRef = useRef(null);
  const tabs = !isEmployee ? CUSTOMER_TABS : isAdmin ? ADMIN_TABS : STAFF_TABS;
  const allowed = useMemo(() => (!isEmployee ? CUSTOMER_SCREENS : [...STAFF_SCREENS, ...(isAdmin ? ADMIN_ONLY : [])]), [isEmployee, isAdmin]);

  useEffect(() => { if (!allowed.includes(screenId)) navigate("/home", { replace: true }); }, [screenId, allowed, navigate]);
  useEffect(() => { warmScreens(allowed); }, [allowed]);
  useEffect(() => { document.title = `${screenId === "home" ? "Home" : screenId[0].toUpperCase() + screenId.slice(1)} · RetailMind`; window.scrollTo({ top: 0 }); }, [screenId]);

  const current = allowed.includes(screenId) ? screenId : "home";
  const activeTab = tabs.some((t) => t.id === current) ? current : "home";
  const entry = current === "home" ? screens.home[isEmployee ? "staff" : "customer"] : screens[current];

  return (
    <div className="app">
      <button type="button" className="skip" data-tid="shell.skip" onClick={() => mainRef.current?.focus()}>Skip to content</button>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand__mark"><Leaf size={19} aria-hidden="true" /></div>
          <div>
            <div className="brand__name">RetailMind</div>
            <div className="brand__tag">{!isEmployee ? "Customer" : isAdmin ? "Admin console" : `${me.access_level[0].toUpperCase()}${me.access_level.slice(1)} console`}</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} type="button" data-tid={`nav.${id}`} className={`nav__item${activeTab === id ? " is-active" : ""}`} aria-current={activeTab === id ? "page" : undefined} onClick={() => navigate(`/${id}`)}>
              <Icon size={19} strokeWidth={activeTab === id ? 2.3 : 2} aria-hidden="true" />{label}
            </button>
          ))}
        </nav>
        <div className="sidebar__foot">
          <Avatar name={me.name} />
          <div className="sidebar__who">
            <div className="sidebar__name ellipsis">{me.name}</div>
            <div className="sidebar__role ellipsis">{me.title || "Customer"}</div>
          </div>
          <button type="button" className="icon-btn icon-btn--plain" aria-label="Sign out" title="Sign out" data-tid="nav.sign-out" onClick={() => signOut()}><LogOut size={17} aria-hidden="true" /></button>
        </div>
      </aside>

      <main id="main" ref={mainRef} tabIndex={-1}>
        <ScreenBoundary key={current}>
          <Suspense fallback={<ScreenFallback />}>
            <ScreenView entry={entry} onNav={(id) => navigate(`/${id}`)} />
          </Suspense>
        </ScreenBoundary>
      </main>

      <nav className="tabbar" aria-label="Main">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button" data-tid={`tab.${id}`} className={`tabbar__item${activeTab === id ? " is-active" : ""}`} aria-current={activeTab === id ? "page" : undefined} onClick={() => navigate(`/${id}`)}>
            <Icon size={23} strokeWidth={activeTab === id ? 2.4 : 2} aria-hidden="true" />{label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Root() {
  const { me, booting, notice } = useSession();
  const [route, navigate] = useHashRoute();
  const toast = useToast();

  // The screen that follows is fetched alongside the work before it, not after: while a saved session is restored,
  // the one in the address; while someone is on the sign-in screen, Home.
  const screenId = route.replace(/^\//, "").split("?")[0] || "home";
  useEffect(() => { if (booting) preload([screens[screenId] ? screenId : "home"]); }, [booting, screenId]);
  useEffect(() => { if (!me && route === "/sign-in") warmScreens(["home"]); }, [me, route]);

  useEffect(() => {
    const onUpdate = () => toast.show("A new version of RetailMind is ready.", { ms: 0, action: { label: "Reload", tid: "app.update-reload", onClick: () => window.location.reload() } });
    window.addEventListener("rm:update-ready", onUpdate);
    return () => window.removeEventListener("rm:update-ready", onUpdate);
  }, [toast]);

  useEffect(() => {
    if (booting) return;
    if (me && (route === "/" || route === "/sign-in")) navigate("/home", { replace: true });
    // A notice ("session ended", "workspace reset") belongs on the sign-in screen, which is where it's shown.
    else if (!me && route !== "/" && route !== "/sign-in") navigate(notice ? "/sign-in" : "/", { replace: true });
  }, [me, booting, route, navigate, notice]);

  if (booting) {
    return <div className="boot" role="status" aria-label="Restoring your session"><div className="brand__mark"><Leaf size={22} aria-hidden="true" /></div></div>;
  }
  if (!me) return route === "/sign-in" ? <SignIn onBack={() => navigate("/")} /> : <Landing />;
  return <Shell screenId={screenId} navigate={navigate} />;
}

export default function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Root />
      </SessionProvider>
    </ToastProvider>
  );
}
