"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ProjectWorkspaceShell } from "../../../../components/projects/project-workspace-shell";
import { BillingUsageCard } from "../../../../components/projects/billing-usage-card";
import { BillingAllowanceField } from "../../../../components/projects/billing-allowance-field";
import { apiFetch } from "../../../../lib/api";
import {
  applyPlanDefaults,
  billingMatchesPlanDefaults,
  formatPlanLabel,
  formatPrice,
  normalizeAllowanceLimit,
  resolvePricingLabel,
  type AllowanceLimit,
  type BillingPlanId,
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
  billingStatus: string;
  billingStartDate?: string | null;
  renewalDate?: string | null;
  internalNotes?: string | null;
  pricingLabel?: BillingPlanId;
  isCustomPricing?: boolean;
  project?: ProjectSummary;
  usage?: { checks: number; automationRuns: number; users: number };
};

const STANDARD_PLANS: BillingPlanId[] = ["FREE", "STARTER", "PRO", "ENTERPRISE"];

const toDateInput = (value?: string | null): string => {
  if (!value) return "";
  return value.slice(0, 10);
};

const normalizeBilling = (row: ProjectBilling): ProjectBilling => ({
  ...row,
  checkLimit: normalizeAllowanceLimit(row.checkLimit),
  userLimit: normalizeAllowanceLimit(row.userLimit),
  automationRunLimit: normalizeAllowanceLimit(row.automationRunLimit)
});

export default function ProjectBillingPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<ProjectSummary | null>(null);
  const [billing, setBilling] = useState<ProjectBilling | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setBilling(
          normalizeBilling({
            ...billingResult.value,
            project: billingResult.value.project ?? {
              id: projectRow.id,
              name: projectRow.name,
              clientName: projectRow.clientName,
              environment: projectRow.environment
            }
          })
        );
      } else {
        setBilling(null);
        throw billingResult.reason;
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

  const projectMeta = project
    ? `${project.environment} · ${project.clientName}`
    : billing?.project
      ? `${billing.project.environment} · ${billing.project.clientName}`
      : null;

  const pricingLabel = useMemo(() => {
    if (!billing) return null;
    return billing.pricingLabel ?? resolvePricingLabel(billing.plan, billing);
  }, [billing]);

  const updateBilling = (patch: Partial<ProjectBilling>) => {
    setBilling((current) => (current ? { ...current, ...patch } : current));
  };

  const onPlanChange = (plan: BillingPlanId) => {
    if (!billing) return;
    if (plan === "CUSTOM") {
      updateBilling({ plan: "CUSTOM" });
      return;
    }
    updateBilling({ plan, ...applyPlanDefaults(plan) });
  };

  const onBillingFieldChange = (patch: Partial<ProjectBilling>) => {
    if (!billing) return;
    const next = normalizeBilling({ ...billing, ...patch });
    const selectedPlan = next.plan === "CUSTOM" ? "CUSTOM" : next.plan;
    const label =
      selectedPlan === "CUSTOM"
        ? "CUSTOM"
        : billingMatchesPlanDefaults(selectedPlan, next)
          ? selectedPlan
          : "CUSTOM";
    updateBilling({ ...patch, plan: label });
  };

  const onAllowanceChange = (field: "checkLimit" | "userLimit" | "automationRunLimit", value: AllowanceLimit) => {
    onBillingFieldChange({ [field]: value });
  };

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!billing) return;
    setSaving(true);
    try {
      await apiFetch(`/projects/${projectId}/billing`, {
        method: "PATCH",
        body: JSON.stringify({
          plan: billing.plan,
          monthlyPrice: billing.monthlyPrice,
          currency: billing.currency,
          billingStatus: billing.billingStatus,
          billingStartDate: billing.billingStartDate || null,
          renewalDate: billing.renewalDate || null,
          dataRetentionDays: billing.dataRetentionDays,
          checkLimit: billing.checkLimit,
          userLimit: billing.userLimit,
          automationRunLimit: billing.automationRunLimit,
          internalNotes: billing.internalNotes ?? null
        })
      });
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
      subtitle="Plan, usage, and entitlement limits for this application only."
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
            disabled={saving}
          >
            {saving ? "Saving…" : "Save billing"}
          </button>
        ) : null
      }
    >
      {projectMeta ? <p className="dashboard-subtle billing-project-meta">{projectMeta}</p> : null}
      {!billing ? (
        <section className="panel workspace-loading">
          <div className="loading-pulse" />
          <p>Loading billing…</p>
        </section>
      ) : (
        <>
          <section className="panel billing-plan-summary">
            <div className="billing-plan-summary__head">
              <div>
                <h2>{formatPlanLabel(billing.plan)} plan</h2>
                {pricingLabel === "CUSTOM" || billing.isCustomPricing ? (
                  <p className="billing-custom-badge">
                    Custom pricing — limits or price differ from standard tier defaults.
                  </p>
                ) : (
                  <p className="dashboard-subtle">Standard {formatPlanLabel(billing.plan)} defaults applied.</p>
                )}
              </div>
              <strong className="billing-plan-summary__price">
                {formatPrice(billing.monthlyPrice, billing.currency)} / month
              </strong>
            </div>
          </section>
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
          <section className="panel">
            <h2>Billing editor</h2>
            <form
              id="project-billing-form"
              className="billing-form-grid"
              onSubmit={(event) => void onSave(event)}
            >
              <label>
                Plan
                <select value={billing.plan} onChange={(event) => onPlanChange(event.target.value as BillingPlanId)}>
                  {[...STANDARD_PLANS, "CUSTOM"].map((plan) => (
                    <option key={plan} value={plan}>
                      {formatPlanLabel(plan)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Monthly price
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={billing.monthlyPrice}
                  onChange={(event) => onBillingFieldChange({ monthlyPrice: Number(event.target.value) })}
                />
              </label>
              <label>
                Currency
                <select
                  value={billing.currency}
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
                  value={billing.billingStatus}
                  onChange={(event) => updateBilling({ billingStatus: event.target.value })}
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
                  value={toDateInput(billing.billingStartDate)}
                  onChange={(event) => updateBilling({ billingStartDate: event.target.value || null })}
                />
              </label>
              <label>
                Renewal date
                <input
                  type="date"
                  value={toDateInput(billing.renewalDate)}
                  onChange={(event) => updateBilling({ renewalDate: event.target.value || null })}
                />
              </label>
              <BillingAllowanceField
                field="checkLimit"
                value={billing.checkLimit}
                onChange={(value) => onAllowanceChange("checkLimit", value)}
              />
              <BillingAllowanceField
                field="userLimit"
                value={billing.userLimit}
                onChange={(value) => onAllowanceChange("userLimit", value)}
              />
              <BillingAllowanceField
                field="automationRunLimit"
                value={billing.automationRunLimit}
                onChange={(value) => onAllowanceChange("automationRunLimit", value)}
              />
              <label>
                Retention days
                <input
                  type="number"
                  min={1}
                  value={billing.dataRetentionDays}
                  onChange={(event) => onBillingFieldChange({ dataRetentionDays: Number(event.target.value) })}
                />
              </label>
              <label className="billing-form-grid__full">
                Internal notes
                <textarea
                  rows={4}
                  value={billing.internalNotes ?? ""}
                  onChange={(event) => updateBilling({ internalNotes: event.target.value })}
                />
              </label>
            </form>
          </section>
        </>
      )}
    </ProjectWorkspaceShell>
  );
}
