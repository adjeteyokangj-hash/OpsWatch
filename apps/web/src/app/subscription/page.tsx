"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Shell } from "../../components/layout/shell";
import { Header } from "../../components/layout/header";
import { PageSection } from "../../components/ui/page-section";
import { apiFetch } from "../../lib/api";

type UsageRow = {
  featureKey: string;
  current: number;
  limit: number | null;
  unlimited: boolean;
};

type AvailablePlan = {
  code: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number | null;
  currency: string;
};

type SubscriptionSummary = {
  subscription: {
    id: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    pendingSync?: boolean;
  } | null;
  plan: { code: string; name: string };
  billingWarning?: string | null;
  accessMode?: string;
  usage: Record<string, UsageRow>;
  availablePlans: AvailablePlan[];
};

type BillingInterval = "monthly" | "annual";

const USAGE_LABELS: Record<string, string> = {
  "monitoring.applications.max": "Applications",
  "monitoring.monitors.max": "Monitors",
  "monitoring.team_members.max": "Team members",
  "monitoring.slos.max": "SLOs",
  "monitoring.status_pages.max": "Status pages",
  "monitoring.notification_channels.max": "Notification channels"
};

const formatUsageLabel = (key: string): string =>
  USAGE_LABELS[key] ??
  key
    .split(".")
    .slice(1)
    .join(" ")
    .replace(/_/g, " ")
    .replace(/\bmax\b/i, "")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());

const formatPrice = (amount: number, currency: string): string => {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
};

const formatDate = (value: string | null): string => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString();
};

const statusClass = (status: string): "pass" | "warn" | "fail" => {
  if (status === "ACTIVE" || status === "TRIAL") return "pass";
  if (status === "PAST_DUE") return "warn";
  return "fail";
};

function SubscriptionPageContent() {
  const searchParams = useSearchParams();
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [actionPlan, setActionPlan] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SubscriptionSummary>("/subscription");
      setSummary(data);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load subscription");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      setNotice("Checkout complete. Your subscription will update shortly after Stripe confirms payment.");
    } else if (checkout === "cancelled") {
      setNotice("Checkout cancelled. No changes were made to your subscription.");
    }
  }, [searchParams]);

  const usageRows = useMemo(() => Object.values(summary?.usage ?? {}), [summary]);
  const currentPlanCode = summary?.plan.code;

  const startCheckout = async (planCode: string) => {
    setActionPlan(planCode);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/subscription/checkout", {
        method: "POST",
        body: JSON.stringify({ planCode, interval })
      });
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message ?? "Failed to start checkout");
      setActionPlan(null);
    }
  };

  const openPortal = async () => {
    setPortalLoading(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/subscription/portal", { method: "POST" });
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message ?? "Failed to open billing portal");
      setPortalLoading(false);
    }
  };

  const priceFor = (plan: AvailablePlan): { amount: number; suffix: string } => {
    if (interval === "annual" && plan.annualPrice != null) {
      return { amount: plan.annualPrice, suffix: "/ year" };
    }
    return { amount: plan.monthlyPrice, suffix: "/ month" };
  };

  return (
    <Shell>
      <Header title="Subscription" />
      {notice ? <section className="panel">{notice}</section> : null}
      {summary?.billingWarning ? (
        <section className="panel error-panel">{summary.billingWarning}</section>
      ) : null}
      {summary?.subscription?.pendingSync ? (
        <section className="panel">
          Checkout completed. Your subscription is syncing from Stripe and should update shortly.
        </section>
      ) : null}
      {error ? <section className="panel error-panel">{error}</section> : null}

      {loading ? (
        <p>Loading subscription…</p>
      ) : summary ? (
        <>
          <PageSection
            title={`${summary.plan.name} plan`}
            className="billing-plan-summary"
            persistKey="org:subscription:summary"
            actions={
              <button
                type="button"
                className="secondary-button"
                onClick={() => void openPortal()}
                disabled={portalLoading}
              >
                {portalLoading ? "Opening…" : "Manage billing"}
              </button>
            }
          >
            {summary.subscription ? (
              <p className="dashboard-subtle">
                <span className={`result-pill ${statusClass(summary.subscription.status)}`}>
                  {summary.subscription.status}
                </span>{" "}
                {summary.subscription.cancelAtPeriodEnd
                  ? `Cancels on ${formatDate(summary.subscription.currentPeriodEnd)}`
                  : `Renews on ${formatDate(summary.subscription.currentPeriodEnd)}`}
              </p>
            ) : (
              <p className="dashboard-subtle">No active subscription record.</p>
            )}
          </PageSection>

          <PageSection
            title="Usage this period"
            description="Current consumption against your plan limits."
            persistKey="org:subscription:usage"
          >
            <div className="billing-usage-grid">
              {usageRows.map((row) => (
                <article className="panel metric-card" key={row.featureKey}>
                  <div className="metric-label">{formatUsageLabel(row.featureKey)}</div>
                  <div className="metric-value">
                    {row.current}
                    {row.unlimited ? " / ∞" : ` / ${row.limit ?? 0}`}
                  </div>
                </article>
              ))}
            </div>
          </PageSection>

          <PageSection
            title="Plans"
            description="Upgrade or change your plan. Billing is handled securely by Stripe."
            persistKey="org:subscription:plans"
            actions={
              <div className="segmented-toggle" role="group" aria-label="Billing interval">
                <button
                  type="button"
                  className={interval === "monthly" ? "active" : ""}
                  onClick={() => setInterval("monthly")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={interval === "annual" ? "active" : ""}
                  onClick={() => setInterval("annual")}
                >
                  Annual
                </button>
              </div>
            }
          >
            <div className="plan-grid">
              {summary.availablePlans.map((plan) => {
                const isCurrent = plan.code === currentPlanCode;
                const { amount, suffix } = priceFor(plan);
                return (
                  <article className={`panel plan-card${isCurrent ? " plan-card--current" : ""}`} key={plan.code}>
                    <h3>{plan.name}</h3>
                    <div className="plan-card__price">
                      <strong>{formatPrice(amount, plan.currency)}</strong> <span>{suffix}</span>
                    </div>
                    {isCurrent ? (
                      <button type="button" className="secondary-button" disabled>
                        Current plan
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void startCheckout(plan.code)}
                        disabled={actionPlan === plan.code}
                      >
                        {actionPlan === plan.code ? "Redirecting…" : "Choose plan"}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </PageSection>
        </>
      ) : (
        <section className="panel">No subscription data available.</section>
      )}
    </Shell>
  );
}

export default function SubscriptionPage() {
  return (
    <Suspense fallback={<Shell><Header title="Subscription" /><p>Loading subscription…</p></Shell>}>
      <SubscriptionPageContent />
    </Suspense>
  );
}
