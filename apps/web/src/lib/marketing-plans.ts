export type MarketingPlanCode = "PILOT" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

export type MarketingPlan = {
  code: MarketingPlanCode;
  name: string;
  monthlyPrice: number | null;
  annualPrice: number | null;
  currency: "GBP";
  blurb: string;
  highlighted?: boolean;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
};

/** Mirrors active launch plans from apps/api entitlements (STARTER omitted). */
export const MARKETING_PLANS: MarketingPlan[] = [
  {
    code: "PILOT",
    name: "Pilot",
    monthlyPrice: 59,
    annualPrice: 590,
    currency: "GBP",
    blurb: "Start agentless monitoring for a small application portfolio.",
    features: [
      "Up to 3 applications",
      "50 monitors with 5 minute checks",
      "Suggested remediation",
      "1 status page",
      "30 day incident retention"
    ],
    ctaLabel: "Start with Pilot",
    ctaHref: "/register?plan=PILOT"
  },
  {
    code: "GROWTH",
    name: "Growth",
    monthlyPrice: 129,
    annualPrice: 1290,
    currency: "GBP",
    blurb: "Add topology depth, AI diagnosis, and approval-gated remediation.",
    highlighted: true,
    features: [
      "Up to 10 applications",
      "150 monitors with 1 minute checks",
      "Advanced topology",
      "AI diagnosis",
      "Remediation approvals",
      "API access"
    ],
    ctaLabel: "Choose Growth",
    ctaHref: "/register?plan=GROWTH"
  },
  {
    code: "BUSINESS",
    name: "Business",
    monthlyPrice: 349,
    annualPrice: 3490,
    currency: "GBP",
    blurb: "Scale operations with autonomous remediation and stronger controls.",
    features: [
      "Up to 30 applications",
      "750 monitors with 30 second checks",
      "Autonomous remediation",
      "SSO and mTLS options",
      "Extended retention"
    ],
    ctaLabel: "Choose Business",
    ctaHref: "/register?plan=BUSINESS"
  },
  {
    code: "ENTERPRISE",
    name: "Enterprise",
    monthlyPrice: null,
    annualPrice: null,
    currency: "GBP",
    blurb: "Custom limits, governance, and rollout support for larger estates.",
    features: [
      "Custom application and monitor limits",
      "Full remediation and security controls",
      "Dedicated onboarding support",
      "Commercial terms to match your estate"
    ],
    ctaLabel: "Talk to us",
    ctaHref: "/contact?topic=enterprise"
  }
];

export const formatMarketingPrice = (monthlyPrice: number | null, currency: string): string => {
  if (monthlyPrice == null) return "Custom";
  const symbol = currency === "GBP" ? "£" : `${currency} `;
  return `${symbol}${monthlyPrice}`;
};
