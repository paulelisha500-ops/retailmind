import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const ToastContext = createContext({ show: () => {} });
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const nextId = useRef(1);

  const show = useCallback((message, { tone = "success", ms = 3200 } = {}) => {
    const id = nextId.current++;
    setItems((prev) => [...prev.slice(-2), { id, message, tone, leaving: false }]);
    setTimeout(() => setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t))), ms);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), ms + 240);
  }, []);

  const value = useMemo(() => ({ show, error: (m) => show(m, { tone: "error", ms: 4600 }) }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-host" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}${t.leaving ? " is-leaving" : ""}`}>
            {t.tone === "error" ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
