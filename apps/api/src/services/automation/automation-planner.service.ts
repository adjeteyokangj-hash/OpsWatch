import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { buildIncidentDiagnosis } from "../remediation/remediation-suggest.service";
import { supersedeActiveAutomationRuns } from "./automation-run-executor.service";
import { selectPlaybookWithLlm } from "./automation-llm-planner.service";
import { resolveLatestApprovedVersion } from "./playbook-governance.service";
import { checkAutomationRateLimits, isPlaybookAutonomousEligible } from "./automation-safeguards.service";
import { executeAutonomousRun } from "./automation-run-executor.service";
import { clampAutomationExecutionMode } from "../entitlements/remediation-governance.service";
import {
  projectAllowsAutonomousExecution,
  resolveProjectAutonomousModeState
} from "./project-autonomous-mode.service";
import { toAutomationRunExecutionMode } from "@opswatch/shared";

const nobleServiceId = (key: string): string => `svc-ne-${key}`;

export type AutomationPlanStep = {
  order: number;
  action: string;
  targetServiceId?: string;
  targetServiceName?: string;
  approvalRequired: boolean;
  description: string;
  rationale?: string;
};

export type AutomationPlan = {
  playbookKey: string;
  playbookVersion: number;
  analysisMode: "RULES" | "CORRELATION" | "LLM";
  confidence: number;
  riskLevel: string;
  executionMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  reason: string;
  steps: AutomationPlanStep[];
  runId?: string;
};

const SERVICE_KEY_TO_ID: Record<string, string> = {
  redis: nobleServiceId("redis"),
  "pricing-engine": nobleServiceId("pricing-engine"),
  "quote-api": nobleServiceId("quote-api"),
  "customer-quote-journey": nobleServiceId("customer-quote-journey")
};

const resolveServiceId = async (
  projectId: string,
  serviceKey?: string | null
): Promise<{ id?: string; name?: string }> => {
  if (!serviceKey) return {};
  const stableId = SERVICE_KEY_TO_ID[serviceKey];
  if (stableId) {
    const row = await prisma.service.findFirst({
      where: { id: stableId, projectId },
      select: { id: true, name: true }
    });
    if (row) return row;
  }
  const byName = await prisma.service.findFirst({
    where: { projectId, name: { contains: serviceKey, mode: "insensitive" } },
    select: { id: true, name: true }
  });
  return byName ?? {};
};

export const selectPlaybookKey = (input: {
  failureClass?: string;
  rootCauseName?: string;
  alertTitles: string[];
}): string => {
  if (input.failureClass === "HTTP_STATUS_MISMATCH") {
    return "HTTP_CHECK_INVESTIGATION";
  }

  const haystack = [input.rootCauseName ?? "", ...input.alertTitles].join(" ").toLowerCase();
  if (haystack.includes("redis")) {
    return "REDIS_CASCADE_RECOVERY";
  }
  if (haystack.includes("webhook")) {
    return "WEBHOOK_DELIVERY_RECOVERY";
  }

  return "HTTP_CHECK_INVESTIGATION";
};

export const planAutomationForIncident = async (input: {
  organizationId: string;
  incidentId: string;
  createdBy?: string;
}): Promise<AutomationPlan | null> => {
  const incident = await prisma.incident.findFirst({
    where: { id: input.incidentId, Project: { organizationId: input.organizationId } },
    include: {
      Project: { select: { id: true, name: true, automationMode: true } },
      IncidentAlert: { include: { Alert: { select: { title: true, serviceId: true } } } }
    }
  });
  if (!incident) return null;

  const modeState = await resolveProjectAutonomousModeState({
    organizationId: input.organizationId,
    projectId: incident.projectId,
    requestedMode: incident.Project.automationMode
  });
  if (!modeState?.capabilities.allowsPlanning) {
    return null;
  }

  const policy = await prisma.automationPolicy.findUnique({
    where: {
      organizationId_policyKey: {
        organizationId: input.organizationId,
        policyKey: "GLOBAL"
      }
    }
  });
  const orgExecutionMode = await clampAutomationExecutionMode(
    input.organizationId,
    (policy?.executionMode ?? "OBSERVE") as AutomationPlan["executionMode"]
  );
  const executionMode = toAutomationRunExecutionMode(modeState.effectiveMode) as AutomationPlan["executionMode"];
  const clampedExecutionMode =
    executionMode === "AUTONOMOUS" && orgExecutionMode !== "AUTONOMOUS"
      ? ("APPROVAL" as AutomationPlan["executionMode"])
      : executionMode === "APPROVAL" && orgExecutionMode === "OBSERVE"
        ? ("OBSERVE" as AutomationPlan["executionMode"])
        : executionMode;

  const diagnosis = await buildIncidentDiagnosis(input.organizationId, {
    incidentId: input.incidentId
  });

  const rateCheck = await checkAutomationRateLimits({
    organizationId: input.organizationId,
    incidentId: input.incidentId,
    phase: "PLAN"
  });
  if (!rateCheck.allowed) {
    throw new Error(rateCheck.reason);
  }

  const llmSelection = await selectPlaybookWithLlm({
    failureClass: diagnosis.failureClass,
    rootCauseName: diagnosis.dependencyImpact?.probableRootCause?.serviceName,
    alertTitles: incident.IncidentAlert.map((row) => row.Alert.title),
    diagnosis: diagnosis.diagnosis,
    narrative: diagnosis.dependencyImpact?.narrative
  });

  const playbookKey = llmSelection.playbookKey;

  const resolved = await resolveLatestApprovedVersion(playbookKey);
  if (!resolved) return null;

  const { playbook, version } = resolved;
  const steps: AutomationPlanStep[] = [];
  for (const step of version.Steps) {
    const target = await resolveServiceId(incident.projectId, step.targetServiceKey);
    steps.push({
      order: step.stepOrder,
      action: step.action,
      targetServiceId: target.id,
      targetServiceName: target.name,
      approvalRequired: step.approvalRequired,
      description: step.description,
      rationale:
        step.action === "VERIFY_SERVICE"
          ? `Dependency verification after upstream recovery (${target.name ?? step.targetServiceKey ?? "scope"}).`
          : step.description
    });
  }

  const reason =
    diagnosis.dependencyImpact?.probableRootCause != null
      ? `${diagnosis.dependencyImpact.probableRootCause.serviceName} is the upstream root cause for this incident.`
      : diagnosis.diagnosis;

  const plan: AutomationPlan = {
    playbookKey: playbook.key,
    playbookVersion: version.version,
    analysisMode: llmSelection.analysisMode === "LLM" ? "LLM" : (diagnosis.analysisMode ?? "CORRELATION"),
    confidence: llmSelection.confidence,
    riskLevel: playbook.riskLevel,
    executionMode: clampedExecutionMode,
    reason: llmSelection.analysisMode === "LLM" ? llmSelection.reason || reason : reason,
    steps
  };

  const runId = randomUUID();
  await supersedeActiveAutomationRuns({
    organizationId: input.organizationId,
    incidentId: incident.id,
    supersededByRunId: runId
  });

  const initialStatus = clampedExecutionMode === "APPROVAL" ? "APPROVAL_PENDING" : "PLANNED";

  const run = await prisma.automationRun.create({
    data: {
      id: runId,
      organizationId: input.organizationId,
      projectId: incident.projectId,
      incidentId: incident.id,
      versionId: version.id,
      executionMode: clampedExecutionMode,
      status: initialStatus,
      planJson: plan as object,
      analysisMode: plan.analysisMode,
      confidence: diagnosis.confidence,
      riskLevel: plan.riskLevel,
      reason: plan.reason,
      createdBy: input.createdBy ?? null,
      updatedAt: new Date(),
      Steps: {
        create: steps.map((step) => ({
          id: randomUUID(),
          stepOrder: step.order,
          action: step.action,
          targetServiceId: step.targetServiceId,
          approvalRequired: step.approvalRequired,
          status: "PENDING"
        }))
      }
    }
  });

  if (
    clampedExecutionMode === "AUTONOMOUS" &&
    policy?.enabled &&
    isPlaybookAutonomousEligible(
      steps.map((step) => ({ action: step.action, approvalRequired: step.approvalRequired }))
    )
  ) {
    const projectGate = await projectAllowsAutonomousExecution({
      organizationId: input.organizationId,
      projectId: incident.projectId,
      requireFullAutonomous: modeState.effectiveMode === "FULL_AUTONOMOUS"
    });
    if (!projectGate.allowed) {
      return { ...plan, runId: run.id };
    }

    void executeAutonomousRun({
      organizationId: input.organizationId,
      runId: run.id,
      executedBy: "automation-autonomous"
    }).catch(() => {
      // Autonomous execution failures are recorded on the run; planning should still succeed.
    });
  }

  return { ...plan, runId: run.id };
};
