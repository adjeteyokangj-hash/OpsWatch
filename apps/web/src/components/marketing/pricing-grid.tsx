"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchSessionUser } from "../../lib/auth";
import { formatMarketingPrice, MARKETING_PLANS } from "../../lib/marketing-plans";

export function PricingGrid() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    void fetchSessionUser().then((user) => setSignedIn(Boolean(user)));
  }, []);

  return (
    <div className="ow-pricing-grid">
      {MARKETING_PLANS.map((plan) => {
        const href = signedIn
          ? plan.code === "ENTERPRISE"
            ? "/contact?topic=enterprise"
            : `/projects?plan=${plan.code}`
          : plan.ctaHref;
        return (
          <article
            key={plan.code}
            className={`ow-price-card${plan.highlighted ? " is-highlighted" : ""}`}
          >
            {plan.highlighted ? <p className="ow-price-badge">Most chosen</p> : null}
            <h3>{plan.name}</h3>
            <p className="ow-price-amount">
              {formatMarketingPrice(plan.monthlyPrice, plan.currency)}
              {plan.monthlyPrice != null ? <span>/month</span> : null}
            </p>
            {plan.annualPrice != null ? (
              <p className="ow-price-annual">or £{plan.annualPrice} billed annually</p>
            ) : (
              <p className="ow-price-annual">Priced for your estate</p>
            )}
            <p className="ow-price-blurb">{plan.blurb}</p>
            <ul>
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <Link href={href} className="ow-btn ow-btn-primary">
              {plan.ctaLabel}
            </Link>
          </article>
        );
      })}
    </div>
  );
}
