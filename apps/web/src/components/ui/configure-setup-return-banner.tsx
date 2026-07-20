"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { parseHighlightNames, safeReturnPath } from "../../lib/safe-return-path";

type Props = {
  /** Fallback copy when highlight names are absent. */
  defaultMessage?: string;
};

/**
 * Surfaces missing configuration names from ?highlight= and a back link from ?returnTo=.
 * Used on setup destinations reached from incident “Configure required setup →” CTAs.
 */
export function ConfigureSetupReturnBanner({
  defaultMessage = "Complete the required setup, then return to the incident."
}: Props) {
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("returnTo"));
  const missingNames = parseHighlightNames(searchParams.get("highlight"));

  if (!returnTo && missingNames.length === 0) return null;

  const backLabel = returnTo?.startsWith("/incidents/")
    ? "← Back to incident"
    : "← Back";

  return (
    <div className="notice-panel" data-testid="configure-setup-return-banner" role="status">
      <p data-testid="configure-setup-highlight">
        {missingNames.length > 0
          ? `Missing configuration: ${missingNames.join(", ")}`
          : defaultMessage}
      </p>
      {returnTo ? (
        <p style={{ marginTop: "8px" }}>
          <Link href={returnTo} className="secondary-button" data-testid="configure-setup-return-link">
            {backLabel}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
