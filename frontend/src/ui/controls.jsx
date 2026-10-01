// Interactive primitives. Every one takes a `tid` — a stable id the test suite uses to prove that
// each control on every screen has been exercised (see scripts/interactive-census.mjs).
import { Check as CheckIcon, Minus, Plus } from "lucide-react";
import { forwardRef } from "react";

const cx = (...parts) => parts.filter(Boolean).join(" ");

export function Button({ variant = "fill", size, block, loading, icon: Icon, tid, className, children, type = "button", disabled, ...rest }) {
  return (
    <button type={type} data-tid={tid} className={cx("btn", `btn--${variant}`, size && `btn--${size}`, block && "btn--block", className)} disabled={loading || disabled} {...rest}>
      {loading ? <span className="spinner" aria-hidden="true" /> : Icon ? <Icon size={size === "sm" ? 15 : 17} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** A link that looks like a Button. For places that must work before any JavaScript has loaded (the landing page). */
export function ButtonLink({ href, variant = "fill", size, tid, className, children, ...rest }) {
  return (
    <a href={href} data-tid={tid} className={cx("btn", `btn--${variant}`, size && `btn--${size}`, className)} {...rest}>
      {children}
    </a>
  );
}

export function IconButton({ label, tid, plain, className, children, ...rest }) {
  return (
    <button type="button" aria-label={label} title={label} data-tid={tid} className={cx("icon-btn", plain && "icon-btn--plain", className)} {...rest}>
      {children}
    </button>
  );
}

/** iOS-style segmented control with a sliding thumb. */
export function Segmented({ options, value, onChange, tid, size, label, className }) {
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  return (
    <div className={cx("seg", size && `seg--${size}`, className)} style={{ "--n": options.length, "--i": index }} role="group" aria-label={label}>
      <span className="seg__thumb" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} type="button" data-tid={`${tid}.${o.id}`} className={cx("seg__btn", o.id === value && "is-active")} aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label, tid }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={label} data-tid={tid} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" />
    </label>
  );
}

export function Check({ checked, onChange, disabled, label, tid }) {
  return (
    <span className="check">
      <input type="checkbox" aria-label={label} data-tid={tid} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="check__box"><CheckIcon size={15} strokeWidth={3} aria-hidden="true" /></span>
    </span>
  );
}

export function Chip({ active, tid, icon: Icon, children, ...rest }) {
  return (
    <button type="button" data-tid={tid} className={cx("chip", active && "is-active")} aria-pressed={!!active} {...rest}>
      {Icon && <Icon size={15} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export const Input = forwardRef(function Input({ tid, className, ...props }, ref) {
  return <input ref={ref} data-tid={tid} className={cx("input", className)} {...props} />;
});

export function Select({ tid, className, children, ...props }) {
  return <select data-tid={tid} className={cx("input", className)} {...props}>{children}</select>;
}

/** A text input with a leading icon (search boxes). */
export const IconInput = forwardRef(function IconInput({ icon: Icon, tid, className, ...props }, ref) {
  return (
    <div className="input-icon">
      <Icon size={17} aria-hidden="true" />
      <input ref={ref} data-tid={tid} className={cx("input", className)} {...props} />
    </div>
  );
});

export function Stepper({ value, onChange, min = 1, max = 999, tid, label }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Decrease ${label ?? "quantity"}`} data-tid={`${tid}.minus`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus size={15} aria-hidden="true" /></button>
      <span aria-live="polite">{value}</span>
      <button type="button" aria-label={`Increase ${label ?? "quantity"}`} data-tid={`${tid}.plus`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus size={15} aria-hidden="true" /></button>
    </div>
  );
}
