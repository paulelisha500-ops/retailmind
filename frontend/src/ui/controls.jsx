// Interactive primitives. Every one takes a `tid` — a stable id the test suite uses to prove that
// each control on every screen has been exercised (see scripts/interactive-census.mjs).
import { Check as CheckIcon, Minus, Plus } from "lucide-react";
import { Children, cloneElement, forwardRef, isValidElement, useId } from "react";

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

const isTextControl = (node) => isValidElement(node) && (node.type === Input || node.type === Select || node.type === IconInput || ["input", "select", "textarea"].includes(node.type));

/**
 * A labelled form row. The label is tied to the control automatically (the first input, select or text area inside),
 * so screen readers announce "Department, combo box" rather than an unnamed control, and clicking the label focuses
 * it. A row holding something else — a group of chips — is labelled as a group instead; a Segmented control already
 * carries its own name. The hint is attached as the control's description.
 */
export function Field({ label, hint, htmlFor, children }) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const hintId = `${uid}-hint`;
  const items = Children.toArray(children);
  const target = items.find(isTextControl);
  const controlId = htmlFor ?? target?.props.id ?? `${uid}-control`;
  const named = items.some((node) => isValidElement(node) && node.type === Segmented);
  const labelsGroup = label && !target && !htmlFor && !named;

  return (
    <div className="field" role={labelsGroup ? "group" : undefined} aria-labelledby={labelsGroup ? labelId : undefined}>
      {label && <label id={labelId} className="field__label" htmlFor={target || htmlFor ? controlId : undefined}>{label}</label>}
      {items.map((node) => (node === target ? cloneElement(node, { id: controlId, "aria-describedby": hint ? hintId : node.props["aria-describedby"] }) : node))}
      {hint && <div id={hintId} className="hint">{hint}</div>}
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
