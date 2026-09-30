import { Leaf, LogOut } from "lucide-react";
import { Suspense, lazy, useEffect, useMemo, useRef } from "react";
import { ADMIN_TABS, CUSTOMER_TABS, STAFF_TABS } from "./lib/catalog.js";
import { useHashRoute } from "./lib/hooks.js";
import Landing from "./screens/Landing.jsx";
import SignIn from "./screens/SignIn.jsx";
import { SessionProvider, useSession } from "./session.jsx";
import { ToastProvider } from "./ui/Toast.jsx";
import { Avatar, Skeleton } from "./ui/display.jsx";

// Every signed-in screen is its own chunk, fetched on demand and warmed while the browser is idle.
const loaders = {
  home: { customer: () => import("./screens/customer/Home.jsx"), staff: () => import("./screens/staff/Home.jsx") },
  list: () => import("./screens/customer/List.jsx"),
  offers: () => import("./screens/customer/Offers.jsx"),
  profile: () => import("./screens/Profile.jsx"),
  cashier: () => import("./screens/staff/Cashier.jsx"),
  tasks: () => import("./screens/staff/Tasks.jsx"),
  monitoring: () => import("./screens/staff/Monitoring.jsx"),
  forecast: () => import("./screens/staff/Forecast.jsx"),
  procurement: () => import("./screens/staff/Procurement.jsx"),
  assistant: () => import("./screens/staff/Assistant.jsx"),
  warehouse: () => import("./screens/staff/Warehouse.jsx"),
  analytics: () => import("./screens/staff/Analytics.jsx"),
  team: () => import("./screens/staff/Team.jsx"),
};

const Screens = {
  homeCustomer: lazy(loaders.home.customer),
  homeStaff: lazy(loaders.home.staff),
  list: lazy(loaders.list), offers: lazy(loaders.offers), profile: lazy(loaders.profile),
  cashier: lazy(loaders.cashier), tasks: lazy(loaders.tasks), monitoring: lazy(loaders.monitoring), forecast: lazy(loaders.forecast),
  procurement: lazy(loaders.procurement), assistant: lazy(loaders.assistant), warehouse: lazy(loaders.warehouse),
  analytics: lazy(loaders.analytics), team: lazy(loaders.team),
};

const CUSTOMER_SCREENS = ["home", "list", "offers", "profile"];
const STAFF_SCREENS = ["home", "cashier", "tasks", "monitoring", "forecast", "procurement", "assistant", "warehouse", "profile"];
const ADMIN_ONLY = ["analytics", "team"];

function warmScreens(ids) {
  const run = () => ids.forEach((id) => { const l = loaders[id]; if (typeof l === "function") l(); else if (l) Object.values(l).forEach((fn) => fn()); });
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 2500 }); else setTimeout(run, 1200);
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
  const Screen = current === "home" ? (isEmployee ? Screens.homeStaff : Screens.homeCustomer) : Screens[current];

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
        <Suspense fallback={<ScreenFallback />}>
          <Screen key={current} onNav={(id) => navigate(`/${id}`)} />
        </Suspense>
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
  const { me, booting } = useSession();
  const [route, navigate] = useHashRoute();

  useEffect(() => {
    if (booting) return;
    if (me && (route === "/" || route === "/sign-in")) navigate("/home", { replace: true });
    else if (!me && route !== "/" && route !== "/sign-in") navigate("/", { replace: true });
  }, [me, booting, route, navigate]);

  if (booting) {
    return <div className="boot" role="status" aria-label="Restoring your session"><div className="brand__mark"><Leaf size={22} aria-hidden="true" /></div></div>;
  }
  if (!me) return route === "/sign-in" ? <SignIn onBack={() => navigate("/")} /> : <Landing onEnter={() => navigate("/sign-in")} />;
  return <Shell screenId={route.replace(/^\//, "").split("?")[0] || "home"} navigate={navigate} />;
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
