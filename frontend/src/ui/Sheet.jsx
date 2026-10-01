import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "./controls.jsx";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A bottom sheet on phones and a centred dialog on larger screens: springs in, dims and blurs what's
 * behind, closes on Escape / backdrop tap / the close button, traps focus, and restores it on exit.
 */
export function Sheet({ open, onClose, title, children, actions, size, tid }) {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      // The panel must stay mounted while it animates out, so visibility is state rather than derived.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true);
      setClosing(false);
      return undefined;
    }
    if (!mounted) return undefined;
    setClosing(true);
    const t = setTimeout(() => { setMounted(false); setClosing(false); }, 210);
    return () => clearTimeout(t);
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const first = panel?.querySelector("input, select, textarea") ?? panel?.querySelector(FOCUSABLE);
    (first ?? panel)?.focus({ preventScroll: true });

    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !panel) return;
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) { e.preventDefault(); return; }
      const [head, tail] = [nodes[0], nodes.at(-1)];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement) previous.focus({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <div className={`sheet-backdrop${closing ? " is-closing" : ""}`} data-tid={`${tid}.backdrop`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} className={`sheet${size ? ` sheet--${size}` : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__head">
          <h2 id={titleId} className="sheet__title">{title}</h2>
          <IconButton label="Close" tid={`${tid}.close`} onClick={onClose}><X size={17} aria-hidden="true" /></IconButton>
        </div>
        <div className="sheet__body">{children}</div>
        {actions && <div className="sheet__actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** A destructive-action confirmation, in the style of an iOS action sheet. */
export function ConfirmSheet({ open, onClose, onConfirm, title, message, confirmLabel = "Delete", busy, tid }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} size="sm" tid={tid}
      actions={<>
        <Button variant="gray" tid={`${tid}.cancel`} onClick={onClose}>Cancel</Button>
        <Button variant="danger-fill" tid={`${tid}.confirm`} loading={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      <p className="t-sub">{message}</p>
    </Sheet>
  );
}
