import Link from "next/link";
import { formatMarketingPrice, MARKETING_PLANS } from "../../lib/marketing-plans";

export function HomePricing() {
  return (
    <div className="ow-home-pricing">
      {MARKETING_PLANS.map((plan) => (
        <article
          key={plan.code}
          className={`ow-home-price-card${plan.highlighted ? " is-highlighted" : ""}`}
        >
          <h3>{plan.name}</h3>
          <p className="ow-price-amount">
            {formatMarketingPrice(plan.monthlyPrice, plan.currency)}
            {plan.monthlyPrice != null ? <span>/mo</span> : null}
          </p>
          <p className="ow-price-blurb">{plan.blurb}</p>
          <ul>
            {plan.features.slice(0, 4).map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
          <Link href={plan.ctaHref} className="ow-btn ow-btn-primary">
            {plan.ctaLabel}
          </Link>
        </article>
      ))}
    </div>
  );
}
