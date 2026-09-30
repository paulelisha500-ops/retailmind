// Presentational primitives: tags, avatars, banners, empty states, skeletons, meters, lists.
import { AlertTriangle, CheckCircle2, ChevronRight, Info, Tag as TagIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CATEGORIES } from "../lib/catalog.js";

const cx = (...parts) => parts.filter(Boolean).join(" ");

const CATEGORY_ICONS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.Icon]));

/** The icon for a product category (a generic tag for anything unknown). */
export function CategoryIcon({ category, ...props }) {
  const Icon = CATEGORY_ICONS[category] ?? TagIcon;
  return <Icon {...props} />;
}

export function Tag({ tone = "neutral", plain, children }) {
  return <span className={cx("tag", tone !== "neutral" && `tag--${tone}`, plain && "tag--plain")}>{children}</span>;
}

export const Avatar = ({ name, large }) => <span className={cx("avatar", large && "avatar--lg")} aria-hidden="true">{(name ?? "?").charAt(0).toUpperCase()}</span>;

const BANNER_ICON = { error: AlertTriangle, warn: AlertTriangle, info: Info, success: CheckCircle2, plain: Info };

export function Banner({ tone = "error", children }) {
  if (!children) return null;
  const Icon = BANNER_ICON[tone];
  return (
    <div className={cx("banner", `banner--${tone}`)} role={tone === "error" ? "alert" : "status"}>
      <Icon size={17} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ icon: Icon, children }) {
  return (
    <div className="empty">
      {Icon && <Icon size={30} aria-hidden="true" />}
      <div>{children}</div>
    </div>
  );
}

export const Skeleton = ({ lines = 3, block }) => (
  <div aria-busy="true" aria-label="Loading">
    {block && <div className="skeleton skeleton-block" />}
    {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton skeleton-line" style={{ width: `${92 - ((i * 17) % 38)}%` }} />)}
  </div>
);

export const CardSkeleton = ({ lines = 3 }) => <div className="card"><Skeleton lines={lines} /></div>;

export function Meter({ pct, tone }) {
  const color = tone === "red" ? "var(--red)" : tone === "amber" ? "var(--amber)" : undefined;
  return (
    <div className="meter" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="meter__fill" style={{ transform: `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`, background: color }} />
    </div>
  );
}

export function Section({ title, action, children, className }) {
  return (
    <section className={cx("section", className)}>
      {(title || action) && <div className="section__title"><span>{title}</span>{action}</div>}
      {children}
    </section>
  );
}

export const List = ({ children, className }) => <div className={cx("list", className)}>{children}</div>;

/**
 * A grouped-list row. Give it `title`/`detail` for the standard layout (with `lead`, `icon`, `aside` and
 * `chevron` around it), or omit both and pass children to lay the row out yourself. `onClick` + `tid`
 * make it a button; `as="label"` wraps a switch or checkbox.
 */
export function ListRow({ as, icon: Icon, iconTone, lead, title, detail, aside, chevron, open, onClick, tid, children, className, ...rest }) {
  const Tag_ = as ?? (onClick ? "button" : "div");
  const props = Tag_ === "button" ? { type: "button", "data-tid": tid, onClick } : {};
  const custom = title === undefined && detail === undefined;
  return (
    <Tag_ className={cx("list-row", className)} {...props} {...rest}>
      {lead}
      {Icon && <span className="list-row__icon" style={iconTone ? { background: `var(--${iconTone})` } : undefined}><Icon size={17} aria-hidden="true" /></span>}
      {custom ? children : (
        <span className="list-row__main">
          {title && <span className="list-row__title">{title}</span>}
          {detail && <span className="list-row__detail" style={{ display: "block" }}>{detail}</span>}
          {children}
        </span>
      )}
      {aside && <span className="list-row__aside">{aside}</span>}
      {chevron && <ChevronRight size={17} className={cx("list-row__chevron", open && "is-open")} aria-hidden="true" />}
    </Tag_>
  );
}

/** Counts up once when scrolled into view (and not at all for people who prefer reduced motion). */
export function NumberTicker({ value, decimals = 0, prefix = "", suffix = "", duration = 900 }) {
  const [shown, setShown] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef(null);
  const instant = typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window));

  useEffect(() => {
    if (instant) return undefined;
    const io = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setStarted(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [value, instant]);

  useEffect(() => {
    if (!started || instant) return undefined;
    let raf;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      setShown(value * (1 - (1 - t) ** 3));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [started, instant, value, duration]);

  const display = instant ? value : shown;
  return <span ref={ref} className="num">{prefix}{display.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

/** Smoothly expands and collapses its content; hidden content leaves the tab order. */
export function Collapse({ open, children }) {
  return (
    <div className={cx("collapse", open && "is-open")}>
      <div className="collapse__inner">{children}</div>
    </div>
  );
}
