import type { AutomationPlan, AutomationRunDetails } from "./automation-plan-types";

type Props = {
  plan: AutomationPlan | null;
  run: AutomationRunDetails | null;
  loading: boolean;
  acting: boolean;
  error: string | null;
  canApprove: boolean;
  onGenerate: () => void;
  onApprove: (reason: string) => void;
  onReject: (reason: string) => void;
  onCancel: () => void;
};

const executionModeLabel: Record<AutomationPlan["executionMode"], string> = {
  OBSERVE: "Observe only",
  APPROVAL: "Approval",
  AUTONOMOUS: "Autonomous"
};

const statusLabel = (status: string): string => status.replace(/_/g, " ").toLowerCase();

export function AutomationPlanPanel({
  plan,
  run,
  loading,
  acting,
  error,
  canApprove,
  onGenerate,
  onApprove,
  onReject,
  onCancel
}: Props) {
  const display = run ?? (plan ? { plan, steps: plan.steps, status: "PLANNED" } : null);
  const activePlan = display?.plan ?? plan;
  const steps = run?.steps ?? plan?.steps ?? [];
  const status = run?.status ?? (plan?.executionMode === "APPROVAL" ? "APPROVAL_PENDING" : "PLANNED");
  const currentStep = run?.currentStepOrder
    ? steps.find((step) => step.order === run.currentStepOrder)
    : null;
  const awaitingApproval = ["PLANNED", "APPROVAL_PENDING"].includes(status);
  const isTerminal = ["COMPLETED", "FAILED", "ROLLED_BACK", "REJECTED", "CANCELLED", "SUPERSEDED"].includes(
    status
  );

  const handleApprove = () => {
    const reason = window.prompt(
      "Approval reason (required):",
      "Reviewed dependency impact and approved low-risk recovery steps."
    );
    if (!reason?.trim()) return;
    onApprove(reason.trim());
  };

  const handleReject = () => {
    const reason = window.prompt("Rejection reason (required):");
    if (!reason?.trim()) return;
    onReject(reason.trim());
  };

  return (
    <section className="panel automation-plan-panel">
      <div className="incident-health-summary-head">
        <div>
          <h2>Automation plan</h2>
          <p className="dashboard-subtle">
            Multi-step operational playbook proposed by Automation AI. Approved runs execute through the existing remediation safety pipeline.
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={onGenerate} disabled={loading || acting}>
          {loading ? "Planning…" : activePlan ? "Regenerate plan" : "Generate plan"}
        </button>
      </div>

      {error ? <p className="dashboard-subtle">{error}</p> : null}

      {!activePlan && !loading && !error ? (
        <p className="dashboard-subtle">No automation plan has been generated for this incident yet.</p>
      ) : null}

      {activePlan ? (
        <div className="automation-plan-body">
          <div className="automation-plan-meta">
            <span className="pill">{activePlan.playbookKey.replace(/_/g, " ").toLowerCase()}</span>
            <span className="pill">Execution mode: {executionModeLabel[activePlan.executionMode]}</span>
            <span className="pill">Status: {statusLabel(status)}</span>
            <span className="pill">Risk: {(run?.riskLevel ?? activePlan.riskLevel).toLowerCase()}</span>
            <span className="pill">{activePlan.confidence}% confidence</span>
            <span className="pill">Playbook v{run?.playbookVersion ?? activePlan.playbookVersion}</span>
          </div>

          {activePlan.executionMode === "APPROVAL" ? (
            <div className="automation-plan-approval-meta">
              <p>
                <span className="metric-label">Approved by</span> {run?.approvedBy ?? "—"}
              </p>
              <p>
                <span className="metric-label">Approval reason</span> {run?.approvalReason ?? "—"}
              </p>
            </div>
          ) : null}

          <p className="automation-plan-reason">{run?.reason ?? activePlan.reason}</p>

          {currentStep ? (
            <p className="automation-plan-progress">
              Step {currentStep.order} of {steps.length}: {currentStep.action.replace(/_/g, " ")}
              {currentStep.targetServiceName ? ` (${currentStep.targetServiceName})` : ""}
            </p>
          ) : null}

          <ol className="automation-plan-steps">
            {steps.map((step) => (
              <li key={step.order} className="automation-plan-step">
                <div className="automation-plan-step-head">
                  <strong>
                    {step.order}. {step.action.replace(/_/g, " ")}
                  </strong>
                  {step.status ? <span className="pill">{statusLabel(step.status)}</span> : null}
                  {step.approvalRequired ? <span className="pill warn">Approval required</span> : null}
                  {step.rollbackAvailable ? <span className="pill">Rollback available</span> : null}
                </div>
                <p>{step.description}</p>
                {step.targetServiceName ? (
                  <p className="dashboard-subtle">Target: {step.targetServiceName}</p>
                ) : null}
                {step.rationale ? <p className="dashboard-subtle">{step.rationale}</p> : null}
              </li>
            ))}
          </ol>

          {run?.outcome ? (
            <p className="automation-plan-outcome">
              {run.outcome.success ? "Completed" : "Finished"}: {run.outcome.summary}
            </p>
          ) : null}

          {activePlan.executionMode === "OBSERVE" ? (
            <p className="dashboard-subtle">
              Observe mode records the plan without executing steps.
            </p>
          ) : null}

          {awaitingApproval && activePlan.executionMode === "APPROVAL" && canApprove ? (
            <div className="automation-plan-actions">
              <button type="button" className="btn primary" disabled={acting} onClick={handleApprove}>
                {acting ? "Running…" : "Approve and run"}
              </button>
              <button type="button" className="btn secondary" disabled={acting} onClick={handleReject}>
                Reject
              </button>
              <button type="button" className="btn secondary" disabled={acting} onClick={onCancel}>
                Cancel plan
              </button>
            </div>
          ) : null}

          {awaitingApproval && activePlan.executionMode === "APPROVAL" && !canApprove ? (
            <p className="dashboard-subtle">
              Awaiting operator approval. Incident responders can review the plan but cannot approve execution.
            </p>
          ) : null}

          {!isTerminal && activePlan.executionMode === "APPROVAL" && canApprove && !awaitingApproval ? (
            <div className="automation-plan-actions">
              <button type="button" className="btn secondary" disabled={acting} onClick={onCancel}>
                Cancel plan
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
