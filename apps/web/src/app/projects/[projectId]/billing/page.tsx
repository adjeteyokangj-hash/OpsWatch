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

type PlanSelection =
  | {
      kind: "INTERNAL";
      id: BillingPlanId;
      name: string;
      monthlyPrice: number;
      annualPrice: number;
      currency: string;
      monthlyAvailable: true;
      annualAvailable: true;
    }
  | {
      kind: "STRIPE";
      id: string;
      name: string;
      monthlyPrice: number;
      annualPrice: number | null;
      currency: string;
      monthlyAvailable: boolean;
      annualAvailable: boolean;
    };

const STANDARD_PLANS: BillingPlanId[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];

const toDateInput = (value?: string | null): string => (value ? value.slice(0, 10) : "");

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

const assertSafeRedirectUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Billing provider returned an unsafe redirect URL.");
  }
  return url.toString();
};

const intervalAvailable = (selection: PlanSelection, interval: BillingInterval): boolean =>
  interval === "ANNUAL" ? selection.annualAvailable : selection.monthlyAvailable;

const selectionPrice = (selection: PlanSelection, interval: BillingInterval): number | null =>
  interval === "ANNUAL" ? selection.annualPrice : selection.monthlyPrice;

export default function ProjectBillingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [billing, setBilling] = useState<ProjectBilling | null>(null);
  const [draft, setDraft] = useState<ProjectBilling | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stripeConfigured, setStripeConfigured] = useState(false);
  const [stripePlans, setStripePlans] = useState<BillingPlanOption[]>([]);
  const [stripeInvoices, setStripeInvoices] = useState<StripeInvoice[]>([]);
  const [stripeBusy, setStripeBusy] = useState<string | null>(null);
  const [planSelection, setPlanSelection] = useState<PlanSelection | null>(null);
  const [selectionInterval, setSelectionInterval] = useState<BillingInterval>("MONTHLY");
  const [planBusy, setPlanBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [projectResult, billingResult] = await Promise.allSettled([
        apiFetch<ProjectSummary & { id: string }>(`/projects/${projectId}`),
        apiFetch<ProjectBilling>(`/projects/${projectId}/billing`)
      ]);

      if (projectResult.status !== "fulfilled") throw projectResult.reason;
      const projectRow = projectResult.value;
      setProject({
        id: projectRow.id,
        name: projectRow.name,
        clientName: projectRow.clientName,
        environment: projectRow.environment
      });

      if (billingResult.status !== "fulfilled") throw billingResult.reason;
      const normalized = normalizeBilling({
        ...billingResult.value,
        project: billingResult.value.project ?? projectRow
      });
      setBilling(normalized);
      setDraft(normalized);
      setDirty(false);

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
      } else {
        setStripeConfigured(false);
        setStripePlans([]);
      }
      if (invoicesResult.status === "fulfilled") {
        setStripeInvoices(invoicesResult.value.invoices);
      } else {
        setStripeInvoices([]);
      }
      setError(null);
    } catch (loadError: any) {
      const message = loadError?.message ?? "Failed to load billing";
      setError(
        /project not found/i.test(message)
          ? "Project not found. Refresh the page or log out and back in."
          : message
      );
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [dirty]);

  const pricingLabel = useMemo(() => {
    if (!billing) return null;
    return billing.pricingLabel ?? resolvePricingLabel(billing.plan, billing);
  }, [billing]);

  const estimatedInvoices = useMemo(() => {
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
    setDraft((current) => (current ? normalizeBilling({ ...current, ...patch }) : current));
    setDirty(true);
  };

  const updatePricingDraft = (patch: Partial<ProjectBilling>) => {
    if (!draft) return;
    const next = normalizeBilling({ ...draft, ...patch });
    const selectedPlan = next.plan === "CUSTOM" ? "CUSTOM" : next.plan;
    const plan =
      selectedPlan === "CUSTOM"
        ? "CUSTOM"
        : billingMatchesPlanDefaults(selectedPlan, next)
          ? selectedPlan
          : "CUSTOM";
    updateDraft({ ...patch, plan });
  };

  const onPlanChange = (plan: BillingPlanId) => {
    if (plan === "CUSTOM") {
      updateDraft({ plan: "CUSTOM" });
      return;
    }
    updateDraft({ plan, ...applyPlanDefaults(plan) });
  };

  const openInternalPlan = (plan: BillingPlanId) => {
    const defaults = PLAN_DEFAULTS[plan];
    setPlanSelection({
      kind: "INTERNAL",
      id: plan,
      name: formatPlanLabel(plan),
      monthlyPrice: defaults.monthlyPrice,
      annualPrice: defaults.monthlyPrice * 12,
      currency: defaults.currency,
      monthlyAvailable: true,
      annualAvailable: true
    });
    setSelectionInterval(billing?.billingInterval ?? "MONTHLY");
    setError(null);
    setNotice(null);
  };

  const openStripePlan = (plan: BillingPlanOption) => {
    setPlanSelection({
      kind: "STRIPE",
      id: plan.code,
      name: plan.name,
      monthlyPrice: plan.monthlyPrice,
      annualPrice: plan.annualPrice,
      currency: plan.currency,
      monthlyAvailable: plan.hasMonthlyPrice,
      annualAvailable: plan.hasAnnualPrice
    });
    const preferred = billing?.billingInterval ?? "MONTHLY";
    setSelectionInterval(
      intervalAvailable(
        {
          kind: "STRIPE",
          id: plan.code,
          name: plan.name,
          monthlyPrice: plan.monthlyPrice,
          annualPrice: plan.annualPrice,
          currency: plan.currency,
          monthlyAvailable: plan.hasMonthlyPrice,
          annualAvailable: plan.hasAnnualPrice
        },
        preferred
      )
        ? preferred
        : plan.hasMonthlyPrice
          ? "MONTHLY"
          : "ANNUAL"
    );
    setError(null);
    setNotice(null);
  };

  const confirmPlanSelection = async () => {
    if (!planSelection || planBusy) return;
    if (!intervalAvailable(planSelection, selectionInterval)) {
      setError(`${formatInterval(selectionInterval)} pricing is not configured for ${planSelection.name}.`);
      return;
    }

    setPlanBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (planSelection.kind === "STRIPE") {
        setStripeBusy(`checkout:${planSelection.id}:${selectionInterval}`);
        const session = await apiFetch<{ url: string }>(`/projects/${projectId}/billing/checkout`, {
          method: "POST",
          body: JSON.stringify({
            planCode: planSelection.id,
            billingInterval: selectionInterval
          })
        });
        window.location.assign(assertSafeRedirectUrl(session.url));
        return;
      }

      await apiFetch(`/projects/${projectId}/billing`, {
        method: "PATCH",
        body: JSON.stringify({
          plan: planSelection.id,
          billingInterval: selectionInterval
        })
      });
      setPlanSelection(null);
      setNotice(
        `${planSelection.name} was saved for ${project?.name ?? "this application"}, billed ${formatInterval(selectionInterval).toLowerCase()}.`
      );
      await load();
    } catch (planError: any) {
      setError(planError?.message ?? "Failed to update the plan");
      setStripeBusy(null);
    } finally {
      setPlanBusy(false);
    }
  };

  const onManageBilling = async () => {
    if (stripeBusy) return;
    setStripeBusy("portal");
    setError(null);
    try {
      const session = await apiFetch<{ url: string }>(`/projects/${projectId}/billing/portal`, {
        method: "POST"
      });
      window.location.assign(assertSafeRedirectUrl(session.url));
    } catch (portalError: any) {
      setError(portalError?.message ?? "Failed to open billing portal");
      setStripeBusy(null);
    }
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving || !dirty) return;

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
      setNotice(`Billing configuration saved for ${project?.name ?? "this application"}.`);
      await load();
    } catch (saveError: any) {
      setError(saveError?.message ?? "Failed to save billing");
    } finally {
      setSaving(false);
    }
  };

  const saveButtonLabel = saving ? "Saving…" : dirty ? "Save configuration" : "Saved";

  return (
    <ProjectWorkspaceShell
      projectId={projectId}
      title="Billing"
      subtitle={
        project
          ? `Plan, usage, and billing for ${project.name} (${project.environment}).`
          : "Plan, usage, and billing for this application only."
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
            data-testid="billing-save-top"
          >
            {saveButtonLabel}
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

      {!billing || !draft ? (
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

          {planSelection ? (
            <section className="panel" role="dialog" aria-modal="false" aria-labelledby="plan-review-title">
              <h2 id="plan-review-title">Review {planSelection.name} plan</h2>
              <p className="dashboard-subtle">
                Choose how this application should be billed before continuing.
              </p>
              <div className="segmented-toggle" role="group" aria-label="Billing interval">
                <button
                  type="button"
                  className={selectionInterval === "MONTHLY" ? "active" : ""}
                  onClick={() => setSelectionInterval("MONTHLY")}
                  disabled={!planSelection.monthlyAvailable || planBusy}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  className={selectionInterval === "ANNUAL" ? "active" : ""}
                  onClick={() => setSelectionInterval("ANNUAL")}
                  disabled={!planSelection.annualAvailable || planBusy}
                >
                  Annual
                </button>
              </div>
              <p style={{ fontSize: "1.25rem", fontWeight: 700 }}>
                {selectionPrice(planSelection, selectionInterval) == null
                  ? "Price unavailable"
                  : `${formatMoney(selectionPrice(planSelection, selectionInterval)!, planSelection.currency)} ${intervalSuffix(selectionInterval)}`}
              </p>
              {!intervalAvailable(planSelection, selectionInterval) ? (
                <p className="dashboard-subtle" role="alert">
                  {formatInterval(selectionInterval)} pricing is not configured for this plan.
                </p>
              ) : null}
              <div className="topology-page-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void confirmPlanSelection()}
                  disabled={planBusy || !intervalAvailable(planSelection, selectionInterval)}
                  data-testid="billing-plan-confirm"
                >
                  {planBusy ? "Processing…" : planSelection.kind === "STRIPE" ? "Continue to secure checkout" : "Save plan"}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setPlanSelection(null)}
                  disabled={planBusy}
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}

          {stripeConfigured ? (
            <PageSection
              title="Subscription & payments"
              description="Select a paid plan, then choose Monthly or Annual before secure checkout."
              persistKey={`project:${projectId}:billing:stripe`}
            >
              <div className="plan-grid">
                {stripePlans.map((plan) => {
                  const isCurrent = billing.planCode === plan.code;
                  return (
                    <article className={`panel plan-card${isCurrent ? " plan-card--current" : ""}`} key={plan.code}>
                      <h3>{plan.name}</h3>
                      <p className="dashboard-subtle">
                        Monthly {formatMoney(plan.monthlyPrice, plan.currency)}
                        {plan.annualPrice != null ? ` · Annual ${formatMoney(plan.annualPrice, plan.currency)}` : ""}
                      </p>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => openStripePlan(plan)}
                        disabled={stripeBusy !== null || (!plan.hasMonthlyPrice && !plan.hasAnnualPrice)}
                      >
                        {!plan.hasMonthlyPrice && !plan.hasAnnualPrice
                          ? "Price unavailable"
                          : isCurrent
                            ? "Review / change billing"
                            : `Choose ${plan.name}`}
                      </button>
                    </article>
                  );
                })}
              </div>
              {billing.stripeCustomerId ? (
                <div className="topology-page-actions" style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void onManageBilling()}
                    disabled={stripeBusy !== null}
                  >
                    {stripeBusy === "portal" ? "Opening…" : "Manage payment, cancellation and invoices"}
                  </button>
                </div>
              ) : null}
            </PageSection>
          ) : (
            <section className="panel">
              <h2>Secure subscription checkout</h2>
              <p className="dashboard-subtle">
                Stripe is not connected, so paid checkout is unavailable. Administrators can still save an internal or custom application plan below.
              </p>
            </section>
          )}

          <PageSection
            title="Change internal plan"
            description="Choose a plan, then confirm Monthly or Annual. This updates this application only and does not charge Stripe."
            persistKey={`project:${projectId}:billing:plans`}
          >
            <div className="plan-grid">
              {STANDARD_PLANS.map((plan) => {
                const defaults = PLAN_DEFAULTS[plan];
                const current = billing.plan === plan;
                return (
                  <article className={`panel plan-card${current ? " plan-card--current" : ""}`} key={plan}>
                    <h3>{formatPlanLabel(plan)}</h3>
                    <p className="dashboard-subtle">
                      {formatMoney(defaults.monthlyPrice, defaults.currency)} / month · {formatMoney(defaults.monthlyPrice * 12, defaults.currency)} / year
                    </p>
                    <button
                      type="button"
                      className={current ? "secondary-button" : "primary-button"}
                      onClick={() => openInternalPlan(plan)}
                      disabled={planBusy}
                    >
                      {current ? "Review current plan" : `Choose ${formatPlanLabel(plan)}`}
                    </button>
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
            <p className="dashboard-subtle">{formatPaymentMethod(billing.paymentMethod)}</p>
            {stripeConfigured && billing.stripeCustomerId ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => void onManageBilling()}
                disabled={stripeBusy !== null}
              >
                {stripeBusy === "portal" ? "Opening…" : "Manage payment method in Stripe"}
              </button>
            ) : (
              <p className="dashboard-subtle">
                Card details are never entered or stored in OpsWatch. Subscribe through Stripe to add a payment method.
              </p>
            )}
          </PageSection>

          <PageSection
            title="Invoices & billing history"
            description={
              stripeConfigured
                ? "Invoices issued by Stripe for this application."
                : "Estimated history derived from the saved internal billing configuration."
            }
            persistKey={`project:${projectId}:billing:invoices`}
          >
            {stripeConfigured ? (
              stripeInvoices.length === 0 ? (
                <p className="dashboard-subtle">No Stripe invoices have been issued for this application.</p>
              ) : (
                <div className="table-cards-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th>Period</th>
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
                          <td>{formatBillingDate(invoice.periodStart)} – {formatBillingDate(invoice.periodEnd)}</td>
                          <td>{formatMoney(invoice.amountPaid || invoice.amountDue, invoice.currency)}</td>
                          <td>{(invoice.status ?? "unknown").toUpperCase()}</td>
                          <td>
                            {invoice.hostedInvoiceUrl ? (
                              <a href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">View</a>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : estimatedInvoices.length === 0 ? (
              <p className="dashboard-subtle">This saved plan has no generated internal billing history.</p>
            ) : (
              <div className="table-cards-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th>Period</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimatedInvoices.map((invoice) => (
                      <tr key={`${invoice.number}-${invoice.status}`}>
                        <td>{invoice.number}</td>
                        <td>{formatBillingDate(invoice.issuedAt)}</td>
                        <td>{formatBillingDate(invoice.periodStart)} – {formatBillingDate(invoice.periodEnd)}</td>
                        <td>{formatMoney(invoice.amount, invoice.currency)}</td>
                        <td><span className={`result-pill ${invoiceStatusClass(invoice.status)}`}>{invoice.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PageSection>

          <PageSection
            title="Custom price plan"
            description="Manually configure this application's internal plan, interval, allowances and retention."
            persistKey={`project:${projectId}:billing:editor`}
          >
            {dirty ? (
              <p className="dashboard-subtle" role="status" data-testid="billing-unsaved-hint">
                Unsaved changes. Use either Save configuration button; both submit this same form.
              </p>
            ) : null}
            <form id="project-billing-form" className="billing-form-grid" onSubmit={(event) => void onSave(event)}>
              <label>
                Plan
                <select value={draft.plan} onChange={(event) => onPlanChange(event.target.value as BillingPlanId)}>
                  {[...STANDARD_PLANS, "CUSTOM"].map((plan) => (
                    <option key={plan} value={plan}>{formatPlanLabel(plan)}</option>
                  ))}
                </select>
              </label>
              <label>
                Billing interval
                <select
                  value={draft.billingInterval}
                  onChange={(event) => updateDraft({ billingInterval: event.target.value as BillingInterval })}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual</option>
                </select>
              </label>
              <label>
                Base monthly price
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.monthlyPrice}
                  onChange={(event) => updatePricingDraft({ monthlyPrice: Number(event.target.value) })}
                />
              </label>
              <label>
                Selected interval total
                <input
                  type="text"
                  readOnly
                  value={formatMoney(intervalPrice(draft.monthlyPrice, draft.billingInterval), draft.currency)}
                />
              </label>
              <label>
                Currency
                <select value={draft.currency} onChange={(event) => updatePricingDraft({ currency: event.target.value })}>
                  <option value="GBP">GBP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </select>
              </label>
              <label>
                Billing status
                <select value={draft.billingStatus} onChange={(event) => updateDraft({ billingStatus: event.target.value })}>
                  {["ACTIVE", "TRIAL", "PAST_DUE", "CANCELLED", "SUSPENDED"].map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>
              <label>
                Billing start date
                <input
                  type="date"
                  value={toDateInput(draft.billingStartDate)}
                  onChange={(event) => updateDraft({ billingStartDate: event.target.value || null })}
                />
              </label>
              <label>
                Renewal date
                <input
                  type="date"
                  value={toDateInput(draft.renewalDate)}
                  onChange={(event) => updateDraft({ renewalDate: event.target.value || null })}
                />
              </label>
              <BillingAllowanceField field="checkLimit" value={draft.checkLimit} onChange={(value: AllowanceLimit) => updatePricingDraft({ checkLimit: value })} />
              <BillingAllowanceField field="userLimit" value={draft.userLimit} onChange={(value: AllowanceLimit) => updatePricingDraft({ userLimit: value })} />
              <BillingAllowanceField field="automationRunLimit" value={draft.automationRunLimit} onChange={(value: AllowanceLimit) => updatePricingDraft({ automationRunLimit: value })} />
              <label>
                Retention days
                <input
                  type="number"
                  min={1}
                  value={draft.dataRetentionDays}
                  onChange={(event) => updatePricingDraft({ dataRetentionDays: Number(event.target.value) })}
                />
              </label>
              <label className="billing-form-grid__full">
                Internal notes
                <textarea rows={4} value={draft.internalNotes ?? ""} onChange={(event) => updateDraft({ internalNotes: event.target.value })} />
              </label>
              <div className="billing-form-grid__full" style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={saving || !dirty}
                  data-testid="billing-save-bottom"
                >
                  {saveButtonLabel}
                </button>
              </div>
            </form>
          </PageSection>
        </>
      )}
    </ProjectWorkspaceShell>
  );
}
