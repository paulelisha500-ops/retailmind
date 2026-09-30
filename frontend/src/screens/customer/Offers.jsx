import { Gift } from "lucide-react";
import { offerIcon } from "../../lib/catalog.js";
import { useQuery } from "../../lib/query.js";
import { useSession } from "../../session.jsx";
import { CardSkeleton, Empty } from "../../ui/display.jsx";
import { ScreenHeader } from "../../ui/ScreenHeader.jsx";

export default function CustomerOffers() {
  const { token } = useSession();
  const { data, loading } = useQuery("/customer/offers", { token });
  return (
    <div className="screen">
      <ScreenHeader title="Offers" subtitle="Promotions running across the store" />
      {loading ? <CardSkeleton /> : data.length === 0 ? (
        <div className="card"><Empty icon={Gift}>No offers are running right now.</Empty></div>
      ) : (
        <div className="stack gap-3">
          {data.map((o) => {
            const Icon = offerIcon(o.tone);
            return (
              <div key={o.id} className={`offer offer--wide offer--${o.tone}`}>
                <span className="offer__icon"><Icon size={20} aria-hidden="true" /></span>
                <div><div className="offer__title">{o.title}</div><div className="offer__sub">{o.subtitle}{o.category ? ` · ${o.category}` : ""}</div></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
