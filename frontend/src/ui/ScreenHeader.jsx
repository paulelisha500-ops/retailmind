import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Large-title header. Screens reached from a tile show a back button; on phones a compact
 * translucent bar fades in once the large title scrolls out of view.
 */
export function ScreenHeader({ title, subtitle, actions, back }) {
  const titleRef = useRef(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const node = titleRef.current;
    if (!node || !("IntersectionObserver" in window)) return undefined;
    const io = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting && entry.boundingClientRect.top < 0), { rootMargin: "-46px 0px 0px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, []);

  return (
    <>
      <div className={`navbar${compact ? " is-visible" : ""}`} aria-hidden="true">{title}</div>
      {back && (
        <button type="button" className="back-btn back-btn--screen" data-tid={back.tid} onClick={back.onClick}>
          <ChevronLeft size={18} aria-hidden="true" />{back.label}
        </button>
      )}
      <header className="screen-head">
        <div className="grow">
          <h1 ref={titleRef} className="t-large">{title}</h1>
          {subtitle && <div className="screen-head__sub">{subtitle}</div>}
        </div>
        {actions && <div className="screen-head__actions">{actions}</div>}
      </header>
    </>
  );
}
