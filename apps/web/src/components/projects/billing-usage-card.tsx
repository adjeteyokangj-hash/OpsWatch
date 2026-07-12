"use client";

import { formatAllowance, normalizeAllowanceLimit, usagePercent, type AllowanceLimit } from "../../lib/project-billing";

type Props = {
  title: string;
  used: number;
  limit?: AllowanceLimit;
  staticLabel?: string;
};

export function BillingUsageCard({ title, used, limit, staticLabel }: Props) {
  const normalizedLimit = limit === undefined ? undefined : normalizeAllowanceLimit(limit);
  const percent = normalizedLimit === undefined ? null : usagePercent(used, normalizedLimit);

  return (
    <article className="billing-usage-card">
      <span className="billing-usage-card__title">{title}</span>
      <strong className="billing-usage-card__value">
        {staticLabel ?? (normalizedLimit === undefined ? `${used}` : formatAllowance(used, normalizedLimit))}
      </strong>
      {percent !== null ? (
        <>
          <div className="billing-usage-card__bar" aria-hidden="true">
            <span className="billing-usage-card__fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="billing-usage-card__percent">{percent}%</span>
        </>
      ) : null}
    </article>
  );
}
