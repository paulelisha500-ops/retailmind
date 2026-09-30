import {
  ArrowRight, BarChart3, Boxes, ChevronRight, Github, Leaf, ShoppingCart, ShieldCheck, TrendingUp, Truck, Users, Video,
} from "lucide-react";
import { EDITION } from "../api.js";
import { Button } from "../ui/controls.jsx";
import { NumberTicker } from "../ui/display.jsx";
import "../styles/landing.css";

const REPO = "https://github.com/paulelisha500-ops/retailmind";

const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

const NAV = [["platform", "Platform"], ["roles", "Roles"], ["editions", "Editions"], ["faq", "FAQ"]];

const FEATURES = [
  { Icon: TrendingUp, title: "Demand forecasting", text: "Seasonal, boosted-tree, LSTM and attention forecasts trained on each store's own sales — with a held-out accuracy score beside every one." },
  { Icon: Truck, title: "Procurement", text: "Purchase orders drafted from forecasts, supplier scorecards, onboarding records and outreach that's logged on every click." },
  { Icon: Video, title: "Shelf & loss alerts", text: "A review queue for stock, quality and loss-prevention flags, routed to the right person and closed by a human decision." },
  { Icon: ShoppingCart, title: "Register & customer app", text: "Six tender types, loyalty points earned and redeemed, digital receipts, a shopping list and recommendations from real history." },
  { Icon: Boxes, title: "Warehouse", text: "Zone utilisation from live stock, a replenishment pick route by aisle, and Saturday staffing scaled from real traffic." },
  { Icon: BarChart3, title: "Profit & loss", text: "Net sales, cost of goods at landed cost, shrinkage and loyalty liability — every figure computed from orders, to gross margin." },
];

const ROLES = [
  { name: "Admin", text: "Store analytics and P&L, team and access, purchase approvals and every store in enterprise mode." },
  { name: "Manager", text: "Inventory, alerts and forecasts for the floor, with the responsibilities an admin assigns." },
  { name: "Staff", text: "Tasks, the register and the alerts routed to them — nothing they aren't allowed to change." },
  { name: "Customer", text: "Find products, build a list, check out, earn points and see offers and receipts." },
];

const FAQ = [
  ["Where does my data live?", EDITION === "browser"
    ? "In your browser. This edition runs the whole platform — database, API and forecasting — inside your tab, and stores your workspace on your device (IndexedDB). Nothing is uploaded; clearing site data resets it."
    : "On your RetailMind server, in PostgreSQL."],
  ["Is the forecasting real?", "Yes. A seasonal-trend regression, gradient-boosted trees, an LSTM and an attention network are trained on the selected store's sales history each time, and every result shows its held-out accuracy (MAPE) so you can see which one to trust."],
  ["What happens when a sale is rung up?", "A real order is created, loyalty points are earned or redeemed, and stock is drawn from real batches, first-expired-first-out — so shelf fill, reorder alerts and the P&L all move with the sale."],
  ["Is the Profit & Loss screen real?", "Net sales, cost of goods sold, gross margin, shrinkage and loyalty liability are all computed from orders and each product's landed cost. It stops at gross margin because rent and payroll aren't modelled."],
  ["Can I try every role?", "Yes. Sign in as an admin, manager, staff member or customer from the workspace accounts on the sign-in screen. Each role sees a genuinely different set of screens and permissions."],
  ["Can I run it on my own servers?", "Yes. The server edition replaces the in-browser engine with the FastAPI and PostgreSQL backend in this repository, run with Docker Compose, for multi-user deployments."],
];

/** A composite of live product pieces — no photography, nothing to download. */
function HeroVisual() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="hv-card hv-forecast">
        <div className="row between"><span className="t-cap">Forecast · Dairy &amp; Chilled</span><span className="tag tag--green">Seasonal</span></div>
        <div className="hv-number">1,884 <small>units next 7 days</small></div>
        <svg viewBox="0 0 260 70" className="hv-spark">
          <path d="M0,50 C20,44 28,22 52,30 S92,54 116,36 S160,10 184,22 S232,38 260,14" />
          <path className="is-dashed" d="M150,30 C170,20 190,16 210,22 S240,30 260,14" />
        </svg>
        <div className="hv-foot">Backtest error <b>8.0%</b></div>
      </div>
      <div className="hv-card hv-alert">
        <span className="tag tag--amber">Stock</span>
        <div className="hv-title">Whole Milk running under par</div>
        <div className="meter"><div className="meter__fill" style={{ transform: "scaleX(0.12)", background: "var(--amber)" }} /></div>
        <div className="hv-foot">Aisle 05 · 96% confidence</div>
      </div>
      <div className="hv-card hv-tasks">
        <span className="t-cap">My tasks today</span>
        {["Restock Aisle 05 · Dairy", "Approve PO-1042", "Quality check — Bakery"].map((t, i) => (
          <div key={t} className="hv-task"><span className={`hv-dot${i === 1 ? " is-done" : ""}`} />{t}</div>
        ))}
      </div>
      <div className="hv-card hv-kpi"><span className="t-cap">Gross margin</span><div className="hv-number">27.4%</div><div className="hv-foot is-up">▲ 1.2 pts vs last period</div></div>
    </div>
  );
}

export default function Landing({ onEnter }) {
  return (
    <div className="landing">
      <header className="l-nav">
        <div className="l-nav__inner">
          <div className="row gap-3"><div className="brand__mark"><Leaf size={18} aria-hidden="true" /></div><span className="l-nav__name">RetailMind</span></div>
          <nav className="l-nav__links" aria-label="Sections">
            {NAV.map(([id, label]) => <button key={id} type="button" className="l-link" data-tid={`landing.nav.${id}`} onClick={() => scrollTo(id)}>{label}</button>)}
          </nav>
          <div className="row gap-2">
            <Button variant="plain" size="sm" tid="landing.nav.sign-in" onClick={onEnter}>Sign in</Button>
            <Button size="sm" tid="landing.nav.open" onClick={onEnter}>Open console</Button>
          </div>
        </div>
      </header>

      <main>
        <section className="l-hero">
          <div className="l-hero__copy">
            <span className="pill"><span className="pill__dot" />Retail operations platform</span>
            <h1 className="l-h1">Every aisle, every shelf, <span>predicted.</span></h1>
            <p className="l-lead">RetailMind forecasts demand, flags shrink, routes procurement and keeps every store team a step ahead — for the people who run the floor and the people who shop it.</p>
            <div className="row gap-3 wrap mb-4">
              <Button size="lg" tid="landing.hero.open" onClick={onEnter}>Open the console<ArrowRight size={18} aria-hidden="true" /></Button>
              <Button size="lg" variant="gray" tid="landing.hero.sign-in" onClick={onEnter}>Sign in</Button>
            </div>
            <dl className="l-stats">
              <div><dt>Forecasting methods</dt><dd><NumberTicker value={4} /></dd></div>
              <div><dt>Payment tenders</dt><dd><NumberTicker value={6} /></dd></div>
              <div><dt>Roles</dt><dd><NumberTicker value={4} /></dd></div>
            </dl>
          </div>
          <HeroVisual />
        </section>

        <section className="l-section" id="platform">
          <div className="l-head"><span className="pill">Platform</span><h2 className="l-h2">One system for forecasting, shelves and people</h2>
            <p className="l-p">A stockout in produce or a slow rack of bread gets caught before it costs a sale — because forecasting, stock, procurement and the register all read the same data.</p></div>
          <div className="l-features">
            {FEATURES.map(({ Icon, title, text }) => (
              <article key={title} className="card l-feature"><div className="l-feature__icon"><Icon size={20} aria-hidden="true" /></div><h3 className="t-headline">{title}</h3><p className="t-sub">{text}</p></article>
            ))}
          </div>
        </section>

        <section className="l-section" id="roles">
          <div className="l-head"><span className="pill">Built for every role</span><h2 className="l-h2">The right screens for the right people</h2></div>
          <div className="l-roles">
            {ROLES.map((r) => (<article key={r.name} className="card"><Users size={18} className="l-role-icon" aria-hidden="true" /><h3 className="t-headline">{r.name}</h3><p className="t-sub mt-1">{r.text}</p></article>))}
          </div>
        </section>

        <section className="l-section">
          <div className="l-glow">
            <span className="pill pill--dark"><ShieldCheck size={14} aria-hidden="true" />Computed, not canned</span>
            <h2 className="l-h2 l-h2--light">Every number traces back to a record</h2>
            <p className="l-lead l-lead--light">Forecasts train on sales history each time you ask. Stock moves on every sale. The P&amp;L is arithmetic over orders and costs. Switch stores and watch it change.</p>
          </div>
        </section>

        <section className="l-section" id="editions">
          <div className="l-head"><span className="pill">Editions</span><h2 className="l-h2">Run it anywhere</h2>
            <p className="l-p">The same interface and the same API, with two ways to host it.</p></div>
          <div className="l-editions">
            <article className="card l-edition">
              <span className="tag tag--green">Browser edition</span>
              <h3 className="t-title">Nothing to install</h3>
              <ul className="l-list"><li>Runs entirely in your browser — no server, no sign-up</li><li>Workspace saved on your device and works offline</li><li>Hosted free on GitHub Pages and Hugging Face</li></ul>
              <Button tid="landing.editions.open" onClick={onEnter}>Open the console<ChevronRight size={17} aria-hidden="true" /></Button>
            </article>
            <article className="card l-edition">
              <span className="tag tag--blue">Server edition</span>
              <h3 className="t-title">Your own infrastructure</h3>
              <ul className="l-list"><li>FastAPI and PostgreSQL behind the same interface</li><li>Shared by every store and user, with real accounts</li><li>One command with Docker Compose</li></ul>
              <a className="btn btn--gray" href={REPO} target="_blank" rel="noopener noreferrer" data-tid="landing.editions.source"><Github size={17} aria-hidden="true" />View the source</a>
            </article>
          </div>
        </section>

        <section className="l-section" id="faq">
          <div className="l-head"><span className="pill">FAQ</span><h2 className="l-h2">Questions people ask first</h2></div>
          <div className="l-faq">
            {FAQ.map(([q, a]) => (
              <details key={q} className="faq"><summary data-tid="landing.faq"><span>{q}</span><span className="plus" aria-hidden="true">+</span></summary><div className="faq__body">{a}</div></details>
            ))}
          </div>
        </section>

        <section className="l-cta">
          <div><h2 className="l-h2 l-h2--light">Ready to see it run?</h2><p className="l-lead l-lead--light">Open the console and pick a role — every screen is live.</p></div>
          <Button size="lg" variant="gray" className="l-cta__btn" tid="landing.cta.open" onClick={onEnter}>Open the console<ArrowRight size={18} aria-hidden="true" /></Button>
        </section>
      </main>

      <footer className="l-footer">
        <div className="row gap-3"><div className="brand__mark"><Leaf size={16} aria-hidden="true" /></div><div><div className="strong">RetailMind</div><div className="t-foot">Fresh operations, predicted.</div></div></div>
        <div className="row gap-4 wrap">
          <a className="l-link" href={REPO} target="_blank" rel="noopener noreferrer" data-tid="landing.footer.source">Source on GitHub</a>
          <button type="button" className="l-link" data-tid="landing.footer.sign-in" onClick={onEnter}>Sign in</button>
        </div>
      </footer>
    </div>
  );
}
