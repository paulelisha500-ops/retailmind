import { ChevronRight, ScanLine } from "lucide-react";
import { useState } from "react";
import { offerIcon } from "../../lib/catalog.js";
import { aed, firstName, loyaltyTier } from "../../lib/format.js";
import { useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { Button } from "../../ui/controls.jsx";
import { CardSkeleton, CategoryIcon, NumberTicker, Section, Tag } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";
import FindProduct from "./FindProduct.jsx";

export default function CustomerHome({ onNav }) {
  const { me, token } = useSession();
  const [finding, setFinding] = useState(false);
  const offers = useQuery("/customer/offers", { token });
  const recs = useQuery("/customer/recommendations", { token });
  const loading = offers.loading || recs.loading;

  return (
    <div className="screen">
      <ScreenHeader title={`Hi, ${firstName(me.name)}`} subtitle="Fresh operations, predicted." />

      <div className="card card--dark loyalty">
        <div>
          <div className="t-cap loyalty__label">Loyalty points</div>
          <div className="loyalty__points"><NumberTicker value={me.loyalty_points} /></div>
        </div>
        <Tag tone="green">{loyaltyTier(me.loyalty_points)}</Tag>
      </div>

      <button type="button" className="find-cta" data-tid="customer-home.find" onClick={() => setFinding(true)}>
        <span className="find-cta__icon"><ScanLine size={22} aria-hidden="true" /></span>
        <span className="grow"><span className="find-cta__title">Find a product</span><span className="find-cta__sub">Nutrition, allergens and real prices</span></span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>

      {loading && <CardSkeleton />}

      {!loading && offers.data?.length > 0 && (
        <Section title="For you today" action={<Button variant="plain" size="sm" tid="customer-home.see-offers" onClick={() => onNav("offers")}>See all</Button>}>
          <div className="offer-grid">
            {offers.data.slice(0, 2).map((o) => {
              const Icon = offerIcon(o.tone);
              return (
                <div key={o.id} className={`offer offer--${o.tone}`}>
                  <Icon size={19} aria-hidden="true" />
                  <div className="offer__title">{o.title}</div>
                  <div className="offer__sub">{o.subtitle}</div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {!loading && recs.data?.length > 0 && (
        <Section title="Recommended for you">
          <ul className="reco-row">
            {recs.data.map((r) => (
              <li key={r.product.id} className="reco">
                <span className="reco__icon"><CategoryIcon category={r.product.category} size={17} aria-hidden="true" /></span>
                <div className="reco__name">{r.product.name}</div>
                <div className="reco__why">{r.reason}</div>
                <div className="reco__price">{aed(r.product.price)}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <FindProduct open={finding} onClose={() => setFinding(false)} onAdded={() => { setFinding(false); onNav("list"); }} />
    </div>
  );
}
