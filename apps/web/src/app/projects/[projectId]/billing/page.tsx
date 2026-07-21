"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { BillingUsageCard } from "../../../../components/projects/billing-usage-card";
import { BillingAllowanceField } from "../../../../components/projects/billing-allowance-field";
import { PageSection } from "../../../../components/ui/page-section";
import { apiFetch } from "../../../../lib/api";
import {
  PLAN_DEFAULTS,
  applyPlanDefaults,
  billingMatchesPlanDefaults,
  computeInvoices,
  formatBillingDate,
  formatInterval,
  formatMoney,
  formatPaymentMethod,
  formatPlanLabel,
  intervalPrice,
  intervalSuffix,
  normalizeAllowanceLimit,
  resolvePricingLabel,
  type AllowanceLimit,
  type BillingInterval,
  type BillingPlanId,
  type PaymentMethod,
  type PlanDefaults
} from "../../../../lib/project-billing";

type ProjectSummary = {
  id: string;
  name: string;
  clientName: string;
  environment: string;
};

type ProjectBilling = PlanDefaults & {
  plan: BillingPlanId;
  planCode?: string | null;
  billingStatus: string;
  billingInterval: BillingInterval;
  billingStartDate?: string | null;
  renewalDate?: string | null;
  internalNotes?: string | null;
  pricingLabel?: BillingPlanId;
  isCustomPricing?: boolean;
  paymentMethod?: PaymentMethod | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  project?: ProjectSummary;
  usage?: { checks: number; automationRuns: number; users: number };
};

type BillingPlanOption = {
  code: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number | null;
  currency: string;
  hasMonthlyPrice: boolean;
  hasAnnualPrice: boolean;
};

type StripeInvoice = {
  id: string;
  number: string | null;
  status: string | null;
  amountDue: number;
  amountPaid: number;
  currency: string;
  created: string;
  periodStart: string | null;
  periodEnd: string | null;
  hostedInvoiceUrl: string | null;
  pdfUrl: string | null;
};

const STANDARD_PLANS: BillingPlanId[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];

const toDateInput = (value?: string | null): string => {
  if (!value) return "";
  return value.slice(0, 10);
};

const statusClass = (status: string): "pass" | "warn" | "fail" => {
  if (status === "ACTIVE" || status === "TRIAL") return "pass";
  if (status === "PAST_DUE") return "warn";
  return "fail";
};

const invoiceStatusClass = (status: string): "pass" | "warn" | "fail" => {
  if (status === "PAID") return "pass";
  if (status === "UPCOMING") return "warn";
  return "fail";
};

const normalizeBilling = (row: ProjectBilling): ProjectBilling => ({
  ...row,
  billingInterval: row.billingInterval === "ANNUAL" ? "ANNUAL" : "MONTHLY",
  checkLimit: normalizeAllowanceLimit(row.checkLimit),
  userLimit: normalizeAllowanceLimit(row.userLimit),
  automationRunLimit: normalizeAllowanceLimit(row.automationRunLimit)
});

export default function ProjectBillingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  // `billing` is the server-authoritative record (only updated after a
  // successful load). `draft` is the editable copy bound to the advanced
  // configuration form, so in-progress edits never fake the active plan in the
  // summary/usage cards.
  const [billing, setBilling] = useState<ProjectBilling | null>(null);
  const [draft, setDraft] = useState<ProjectBilling | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<BillingInterval>("MONTHLY");
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [stripePlans, setStripePlans] = useState<BillingPlanOption[]>([]);
  const [stripeInvoices, setStripeInvoices] = useState<StripeInvoice[]>([]);
  const [stripeBusy, setStripeBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [projectResult, billingResult] = await Promise.allSettled([
        apiFetch<ProjectSummary & { id: string }>(`/projects/${projectId}`),
        apiFetch<ProjectBilling>(`/projects/${projectId}/billing`)
      ]);

      if (projectResult.status !== "fulfilled") {
        throw projectResult.reason;
      }

      const projectRow = projectResult.value;
      setProject({
        id: projectRow.id,
        name: projectRow.name,
        clientName: projectRow.clientName,
        environment: projectRow.environment
      });

      if (billingResult.status === "fulfilled") {
        const normalized = normalizeBilling({
          ...billingResult.value,
          project: billingResult.value.project ?? {
            id: projectRow.id,
            name: projectRow.name,
            clientName: projectRow.clientName,
            environment: projectRow.environment
          }
        });
        setBilling(normalized);
        setDraft(normalized);
        setDirty(false);
        setSelectedInterval(normalized.billingInterval);
      } else {
        setBilling(null);
        setDraft(null);
        setDirty(false);
        throw billingResult.reason;
      }

      const [plansResult, invoicesResult] = await Promise.allSettled([
        apiFetch<{ stripeConfigured: boolean; plans: BillingPlanOption[] }>(
          `/projects/${projectId}/billing/plans`
        ),
        apiFetch<{ stripeConfigured: boolean; invoices: StripeInvoice[] }>(
          `/projects/${projectId}/billing/invoices`
        )
      ]);
      if (plansResult.status === "fulfilled") {
        setStripeConfigured(plansResult.value.stripeConfigured);
        setStripePlans(plansResult.value.plans);
      }
      if (invoicesResult.status === "fulfilled") {
        setStripeInvoices(invoicesResult.value.invoices);
      }

      setError(null);
    } catch (err: any) {
      const message = err?.message ?? "Failed to load billing";
      if (/project not found/i.test(message)) {
        setError("Project not found. Your session may be stale after a database repair — refresh the page or log out and back in.");
      } else {
        setError(message);
      }
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchBilling = useCallback(
    async (patch: Record<string, unknown>) => {
      await apiFetch(`/projects/${projectId}/billing`, {
        method: "PATCH",
        body: JSON.stringify(patch)
      });
      await load();
    },
    [projectId, load]
  );

  const projectMeta = project
    ? `${project.environment} · ${project.clientName}`
    : billing?.project
      ? `${billing.project.environment} · ${billing.project.clientName}`
      : null;

  const pricingLabel = useMemo(() => {
    if (!billing) return null;
    return billing.pricingLabel ?? resolvePricingLabel(billing.plan, billing);
  }, [billing]);

  const invoices = useMemo(() => {
    if (!billing) return [];
    return computeInvoices({
      monthlyPrice: billing.monthlyPrice,
      currency: billing.currency,
      interval: billing.billingInterval,
      billingStartDate: billing.billingStartDate,
      renewalDate: billing.renewalDate,
      billingStatus: billing.billingStatus
    });
  }, [billing]);

  const updateDraft = (patch: Partial<ProjectBilling>) => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  };

  const onPlanChange = (plan: BillingPlanId) => {
    if (!draft) return;
    if (plan === "CUSTOM") {
      updateDraft({ plan: "CUSTOM" });
      return;
    }
    updateDraft({ plan, ...applyPlanDefaults(plan) });
  };

  const onBillingFieldChange = (patch: Partial<ProjectBilling>) => {
    if (!draft) return;
    const next = normalizeBilling({ ...draft, ...patch });
    const selectedPlan = next.plan === "CUSTOM" ? "CUSTOM" : next.plan;
    const label =
      selectedPlan === "CUSTOM"
        ? "CUSTOM"
        : billingMatchesPlanDefaults(selectedPlan, next)
          ? selectedPlan
          : "CUSTOM";
    updateDraft({ ...patch, plan: label });
  };

  const onAllowanceChange = (field: "checkLimit" | "userLimit" | "automationRunLimit", value: AllowanceLimit) => {
    onBillingFieldChange({ [field]: value });
  };

  const onChoosePlan = async (plan: BillingPlanId) => {
    if (!billing) return;
    const key = `${plan}:${selectedInterval}`;
    setPlanSaving(key);
    setError(null);
    setNotice(null);
    try {
      await patchBilling({ plan, billingInterval: selectedInterval });
      setNotice(`Updated to the ${formatPlanLabel(plan)} plan, billed ${formatInterval(selectedInterval).toLowerCase()}.`);
    } catch (err: any) {
      setError(err?.message ?? "Failed to change plan");
    } finally {
      setPlanSaving(null);
    }
  };

  const onStripeCheckout = async (planCode: string) => {
    const key = `checkout:${planCode}:${selectedInterval}`;
    setStripeBusy(key);
    setError(null);
    setNotice(null);
    try {
      const session = await apiFetch<{ url: string }>(`/projects/${projectId}/billing/checkout`, {
        method: "POST",
        body: JSON.stringify({ planCode, billingInterval: selectedInterval })
      });
      window.location.assign(session.url);
    } catch (err: any) {
      setError(err?.message ?? "Failed to start checkout");
      setStripeBusy(null);
    }
  };

  const onManageBilling = async () => {
    setStripeBusy("portal");
    setError(null);
    setNotice(null);
    try {
      const session = await apiFetch<{ url: string }>(`/projects/${projectId}/billing/portal`, {
        method: "POST"
      });
      window.location.assign(session.url);
    } catch (err: any) {
      setError(err?.message ?? "Failed to open billing portal");
      setStripeBusy(null);
    }
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/projects/${projectId}/billing`, {
        method: "PATCH",
        body: JSON.stringify({
          plan: draft.plan,
          monthlyPrice: draft.monthlyPrice,
          currency: draft.currency,
          billingStatus: draft.billingStatus,
          billingInterval: draft.billingInterval,
          billingStartDate: draft.billingStartDate || null,
          renewalDate: draft.renewalDate || null,
          dataRetentionDays: draft.dataRetentionDays,
          checkLimit: draft.checkLimit,
          userLimit: draft.userLimit,
          automationRunLimit: draft.automationRunLimit,
          internalNotes: draft.internalNotes ?? null
        })
      });
      setNotice("Billing configuration saved for this application.");
      await load();
    } catch (err: any) {
      setError(err?.message ?? "Failed to save billing");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Billing"
      subtitle={
        project ? `Plan, usage, and billing for ${project.name} (${project.environment}).` : "Plan, usage, and billing for this application only."
      }
      breadcrumbLabel="Billing"
      project={project}
      loading={!project && !error}
      error={error}
      actions={
        billing ? (
          <button
            type="submit"
            form="project-billing-form"
            className="primary-button"
            disabled={saving || !dirty}
          >
            {saving ? "Saving…" : dirty ? "Save configuration" : "Saved"}
          </button>
        ) : null
      }
    >
      {notice ? (
        <section className="panel" role="status">
          {notice}
        </section>
      ) : null}

      <section className="panel billing-scope-banner" aria-label="Billing scope">
        <div className="billing-scope-banner__head">
          <h2 style={{ margin: 0 }}>Billing · {project?.name ?? "This application"}</h2>
          <div className="billing-app-context">
            <span className="meta-chip">{project?.environment ?? billing?.project?.environment ?? "—"}</span>
            <span className="meta-chip">Client {project?.clientName ?? billing?.project?.clientName ?? "—"}</span>
          </div>
        </div>
        <p className="dashboard-subtle" style={{ margin: "8px 0 0" }}>
          Billing applies only to this application. Other applications keep independent plans and pricing.
        </p>
      </section>

      {!billing ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading billing…</p>
        </section>
      ) : (
        <>
          <PageSection
            title={`${formatPlanLabel(billing.plan)} plan`}
            description={
              pricingLabel === "CUSTOM" || billing.isCustomPricing
                ? "Custom pricing — limits or price differ from standard tier defaults."
                : `Standard ${formatPlanLabel(billing.plan)} defaults applied.`
            }
            className="billing-plan-summary"
            persistKey={`project:${projectId}:billing:summary`}
            actions={
              <strong className="billing-plan-summary__price">
                {formatMoney(intervalPrice(billing.monthlyPrice, billing.billingInterval), billing.currency)}{" "}
                {intervalSuffix(billing.billingInterval)}
              </strong>
            }
          >
            <div className="billing-usage-grid">
              <article className="panel metric-card">
                <div className="metric-label">Current plan</div>
                <div className="metric-value">{formatPlanLabel(billing.plan)}</div>
              </article>
              <article className="panel metric-card">
                <div className="metric-label">Subscription status</div>
                <div className="metric-value">
                  <span className={`result-pill ${statusClass(billing.billingStatus)}`}>{billing.billingStatus}</span>
                </div>
              </article>
              <article className="panel metric-card">
                <div className="metric-label">Billing interval</div>
                <div className="metric-value">{formatInterval(billing.billingInterval)}</div>
              </article>
              <article className="panel metric-card">
                <div className="metric-label">Renewal date</div>
                <div className="metric-value">{formatBillingDate(billing.renewalDate)}</div>
              </article>
            </div>
          </PageSection>

          <PageSection
            title="Usage against plan limits"
            description="Current consumption for this application against its plan allowances."
            persistKey={`project:${projectId}:billing:usage`}
          >
            <section className="billing-usage-grid">
              <BillingUsageCard title="Checks" used={billing.usage?.checks ?? 0} limit={billing.checkLimit} />
              <BillingUsageCard
                title="Automation runs"
                used={billing.usage?.automationRuns ?? 0}
                limit={billing.automationRunLimit}
              />
              <BillingUsageCard title="Users" used={billing.usage?.users ?? 0} limit={billing.userLimit} />
              <BillingUsageCard
                title="Retention"
                used={billing.dataRetentionDays}
                staticLabel={`${billing.dataRetentionDays} days`}
              />
            </section>
          </PageSection>

          {stripeConfigured ? (
            <PageSection
              title="Subscription &amp; payments"
              description="This application has its own Stripe subscription, independent of every other application."
              persistKey={`project:${projectId}:billing:stripe`}
              actions={
                <div className="segmented-toggle" role="group" aria-label="Billing interval">
                  <button
                    type="button"
                    className={selectedInterval === "MONTHLY" ? "active" : ""}
                    onClick={() => setSelectedInterval("MONTHLY")}
                  >
                    Monthly
                  </button>
                  <button
                    type="button"
                    className={selectedInterval === "ANNUAL" ? "active" : ""}
                    onClick={() => setSelectedInterval("ANNUAL")}
                  >
                    Annual
                  </button>
                </div>
              }
            >
              <div className="billing-usage-grid">
                <article className="panel metric-card">
                  <div className="metric-label">Subscription plan</div>
                  <div className="metric-value">{billing.planCode ?? "Not subscribed"}</div>
                </article>
                <article className="panel metric-card">
                  <div className="metric-label">Stripe status</div>
                  <div className="metric-value">
                    <span className={`result-pill ${statusClass(billing.billingStatus)}`}>
                      {billing.stripeSubscriptionId ? billing.billingStatus : "NONE"}
                    </span>
                  </div>
                </article>
                <article className="panel metric-card">
                  <div className="metric-label">Renews / ends</div>
                  <div className="metric-value">{formatBillingDate(billing.currentPeriodEnd ?? billing.renewalDate)}</div>
                </article>
              </div>
              <div className="plan-grid" style={{ marginTop: "12px" }}>
                {stripePlans.map((plan) => {
                  const hasPrice = selectedInterval === "ANNUAL" ? plan.hasAnnualPrice : plan.hasMonthlyPrice;
                  const rawPrice =
                    selectedInterval === "ANNUAL" ? plan.annualPrice ?? plan.monthlyPrice * 12 : plan.monthlyPrice;
                  const isCurrent = billing.planCode === plan.code;
                  const busyKey = `checkout:${plan.code}:${selectedInterval}`;
                  return (
                    <article className={`panel plan-card${isCurrent ? " plan-card--current" : ""}`} key={plan.code}>
                      <h3>{plan.name}</h3>
                      <div className="plan-card__price">
                        <strong>{formatMoney(rawPrice, plan.currency)}</strong> <span>{intervalSuffix(selectedInterval)}</span>
                      </div>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void onStripeCheckout(plan.code)}
                        disabled={!hasPrice || stripeBusy !== null}
                      >
                        {stripeBusy === busyKey
                          ? "Redirecting…"
                          : !hasPrice
                            ? "Price unavailable"
                            : isCurrent
                              ? "Change / renew"
                              : `Subscribe to ${plan.name}`}
                      </button>
                    </article>
                  );
                })}
              </div>
              {billing.stripeCustomerId ? (
                <div className="topology-page-actions" style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void onManageBilling()}
                    disabled={stripeBusy !== null}
                  >
                    {stripeBusy === "portal" ? "Opening…" : "Manage billing (payment, cancel, invoices)"}
                  </button>
                </div>
              ) : null}
            </PageSection>
          ) : null}

          <PageSection
            title="Change plan"
            description={
              stripeConfigured
                ? "Internal plan/pricing record for this application (does not charge Stripe)."
                : "Upgrade or downgrade the plan for this application only."
            }
            persistKey={`project:${projectId}:billing:plans`}
            actions={
              <div className="segmented-toggle" role="group" aria-label="Billing interval">
                <button
                  type="button"
                  className={selectedInterval === "MONTHLY" ? "active" : ""}
                  onClick={() => setSelectedInterval("MONTHLY")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={selectedInterval === "ANNUAL" ? "active" : ""}
                  onClick={() => setSelectedInterval("ANNUAL")}
                >
                  Annual
                </button>
              </div>
            }
          >
            {billing.plan === "CUSTOM" ? (
              <p className="dashboard-subtle">
                This application is on a <strong>Custom</strong> plan. Choosing a standard plan below will replace it with that
                tier&apos;s pricing and limits.
              </p>
            ) : null}
            <div className="plan-grid">
              {STANDARD_PLANS.map((plan) => {
                const defaults = PLAN_DEFAULTS[plan];
                const price = intervalPrice(defaults.monthlyPrice, selectedInterval);
                const isCurrentPlan = billing.plan === plan;
                const isCurrentSelection = isCurrentPlan && billing.billingInterval === selectedInterval;
                const busyKey = `${plan}:${selectedInterval}`;
                return (
                  <article className={`panel plan-card${isCurrentSelection ? " plan-card--current" : ""}`} key={plan}>
                    <h3>{formatPlanLabel(plan)}</h3>
                    <div className="plan-card__price">
                      <strong>{formatMoney(price, defaults.currency)}</strong> <span>{intervalSuffix(selectedInterval)}</span>
                    </div>
                    {isCurrentSelection ? (
                      <button type="button" className="secondary-button" disabled>
                        Current plan
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => void onChoosePlan(plan)}
                        disabled={planSaving !== null}
                      >
                        {planSaving === busyKey
                          ? "Applying…"
                          : isCurrentPlan
                            ? `Switch to ${formatInterval(selectedInterval).toLowerCase()}`
                            : `Choose ${formatPlanLabel(plan)}`}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          </PageSection>

          <PageSection
            title="Payment method"
            description="Payment method for this application only."
            persistKey={`project:${projectId}:billing:payment`}
          >
            <p className="dashboard-subtle billing-payment-current">
              {formatPaymentMethod(billing.paymentMethod)}
              {billing.paymentMethod?.updatedAt ? (
                <span className="dashboard-subtle"> · updated {formatBillingDate(billing.paymentMethod.updatedAt)}</span>
              ) : null}
            </p>
            {stripeConfigured ? (
              billing.stripeCustomerId ? (
                <>
                  <p className="dashboard-subtle">
                    Payment methods are managed securely by Stripe. Card details are never entered or stored in OpsWatch.
                  </p>
                  <div className="topology-page-actions" style={{ marginTop: "12px" }}>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void onManageBilling()}
                      disabled={stripeBusy !== null}
                    >
                      {stripeBusy === "portal" ? "Opening…" : "Manage payment method in Stripe"}
                    </button>
                  </div>
                </>
              ) : (
                <p className="dashboard-subtle">
                  Subscribe to a plan above to add a payment method. It will then be managed securely through Stripe.
                </p>
              )
            ) : (
              <p className="dashboard-subtle">
                Stripe is not connected for this workspace, so no payment method can be stored for this application. Card
                details are never entered or stored in OpsWatch.
              </p>
            )}
          </PageSection>

          <PageSection
            title="Invoices & billing history"
            description={
              stripeConfigured
                ? "Invoices issued by Stripe for this application's subscription."
                : "Estimated invoices derived from this application's plan, price, and billing cycle (Stripe not connected)."
            }
            persistKey={`project:${projectId}:billing:invoices`}
          >
            {stripeConfigured ? (
              stripeInvoices.length === 0 ? (
                <p className="dashboard-subtle">
                  No Stripe invoices yet for this application. They appear here after the first payment.
                </p>
              ) : (
                <div className="table-cards-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Billing period</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {stripeInvoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td>{invoice.number ?? invoice.id}</td>
                          <td>{formatBillingDate(invoice.created)}</td>
                          <td>
                            {formatBillingDate(invoice.periodStart)} – {formatBillingDate(invoice.periodEnd)}
                          </td>
                          <td>{formatMoney(invoice.amountPaid || invoice.amountDue, invoice.currency)}</td>
                          <td>
                            <span
                              className={`result-pill ${invoice.status === "paid" ? "pass" : invoice.status === "open" ? "warn" : "fail"}`}
                            >
                              {(invoice.status ?? "unknown").toUpperCase()}
                            </span>
                          </td>
                          <td>
                            {invoice.hostedInvoiceUrl ? (
                              <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">
                                View
                              </a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : invoices.length === 0 ? (
              <p className="dashboard-subtle">
                This application&apos;s plan has no charges, so no invoices have been generated.
              </p>
            ) : (
              <div className="table-cards-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th>Billing period</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={`${invoice.number}-${invoice.status}`}>
                        <td>{invoice.number}</td>
                        <td>{formatBillingDate(invoice.issuedAt)}</td>
                        <td>
                          {formatBillingDate(invoice.periodStart)} – {formatBillingDate(invoice.periodEnd)}
                        </td>
                        <td>{formatMoney(invoice.amount, invoice.currency)}</td>
                        <td>
                          <span className={`result-pill ${invoiceStatusClass(invoice.status)}`}>{invoice.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PageSection>

          <PageSection
            title="Advanced billing configuration"
            description="Fine-tune plan, price, allowances, and retention for this application."
            persistKey={`project:${projectId}:billing:editor`}
            defaultCollapsed
          >
            {dirty ? (
              <p className="dashboard-subtle" role="status" data-testid="billing-unsaved-hint">
                Unsaved changes. The summary above still shows the saved{" "}
                <strong>{formatPlanLabel(billing.plan)}</strong> plan until you select{" "}
                <strong>Save configuration</strong>.
              </p>
            ) : null}
            <form
              id="project-billing-form"
              className="billing-form-grid"
              onSubmit={(event) => void onSave(event)}
            >
              <label>
                Plan
                <select value={draft?.plan ?? billing.plan} onChange={(event) => onPlanChange(event.target.value as BillingPlanId)}>
                  {[...STANDARD_PLANS, "CUSTOM"].map((plan) => (
                    <option key={plan} value={plan}>
                      {formatPlanLabel(plan)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Billing interval
                <select
                  value={draft?.billingInterval ?? billing.billingInterval}
                  onChange={(event) => updateDraft({ billingInterval: event.target.value as BillingInterval })}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual</option>
                </select>
              </label>
              <label>
                Monthly price
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={draft?.monthlyPrice ?? billing.monthlyPrice}
                  onChange={(event) => onBillingFieldChange({ monthlyPrice: Number(event.target.value) })}
                />
              </label>
              <label>
                Currency
                <select
                  value={draft?.currency ?? billing.currency}
                  onChange={(event) => onBillingFieldChange({ currency: event.target.value })}
                >
                  <option value="GBP">GBP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <label>
                Billing status
                <select
                  value={draft?.billingStatus ?? billing.billingStatus}
                  onChange={(event) => updateDraft({ billingStatus: event.target.value })}
                >
                  {["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED", "SUSPENDED"].map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Billing start date
                <input
                  type="date"
                  value={toDateInput(draft?.billingStartDate ?? billing.billingStartDate)}
                  onChange={(event) => updateDraft({ billingStartDate: event.target.value || null })}
                />
              </label>
              <label>
                Renewal date
                <input
                  type="date"
                  value={toDateInput(draft?.renewalDate ?? billing.renewalDate)}
                  onChange={(event) => updateDraft({ renewalDate: event.target.value || null })}
                />
              </label>
              <BillingAllowanceField
                field="checkLimit"
                value={draft?.checkLimit ?? billing.checkLimit}
                onChange={(value) => onAllowanceChange("checkLimit", value)}
              />
              <BillingAllowanceField
                field="userLimit"
                value={draft?.userLimit ?? billing.userLimit}
                onChange={(value) => onAllowanceChange("userLimit", value)}
              />
              <BillingAllowanceField
                field="automationRunLimit"
                value={draft?.automationRunLimit ?? billing.automationRunLimit}
                onChange={(value) => onAllowanceChange("automationRunLimit", value)}
              />
              <label>
                Retention days
                <input
                  type="number"
                  min={1}
                  value={draft?.dataRetentionDays ?? billing.dataRetentionDays}
                  onChange={(event) => onBillingFieldChange({ dataRetentionDays: Number(event.target.value) })}
                />
              </label>
              <label className="billing-form-grid__full">
                Internal notes
                <textarea
                  rows={4}
                  value={draft?.internalNotes ?? ""}
                  onChange={(event) => updateDraft({ internalNotes: event.target.value })}
                />
              </label>
            </form>
          </PageSection>
        </>
      )}
    </ProjectWorkspaceShell>
  );
}
