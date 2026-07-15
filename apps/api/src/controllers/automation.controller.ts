import { Response } from "express";
import { randomUUID } from "crypto";
import type { AuthRequest } from "../middleware/auth";
import { hasPermission } from "../auth/permissions";
import { planAutomationForIncident } from "../services/automation/automation-planner.service";
import {
  approveAutomationRun,
  cancelAutomationRun,
  rejectAutomationRun,
  requestAutomationApproval
} from "../services/automation/automation-run-executor.service";
import { prisma } from "../lib/prisma";
import {
  REMEDIATION_REGISTRY,
  type RemediationAction
} from "../services/remediation/actions";
import { runAutomationTestMode } from "../services/controlled-automation.service";

const orgIdOr403 = (req: AuthRequest, res: Response): string | null => {
  const orgId = req.user?.organizationId;
  if (!orgId) {
    res.status(403).json({ error: "Organization required" });
    return null;
  }
  return orgId;
};

export const createAutomationPlan = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const incidentId = typeof req.body?.incidentId === "string" ? req.body.incidentId : req.params.incidentId;
  if (!incidentId) {
    res.status(400).json({ error: "incidentId is required" });
    return;
  }

  const plan = await planAutomationForIncident({
    organizationId: orgId,
    incidentId,
    createdBy: typeof req.user?.sub === "string" ? req.user.sub : undefined
  });
  if (!plan) {
    res.status(404).json({ error: "Incident or playbook not found" });
    return;
  }

  res.status(201).json({
    ...plan,
    status: executionModeFromPlan(plan),
    permissions: {
      canApprove: hasPermission(req.user?.role, "automation:plan:approve")
    }
  });
};

const executionModeFromPlan = (plan: { executionMode: string }): string =>
  plan.executionMode === "APPROVAL" ? "APPROVAL_PENDING" : "PLANNED";

export const listAutomationPlaybooks = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const rows = await prisma.automationPlaybook.findMany({
    where: { isActive: true },
    include: {
      Versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { Steps: { orderBy: { stepOrder: "asc" } } }
      }
    },
    orderBy: { name: "asc" }
  });

  res.json(
    rows.map((row) => ({
      key: row.key,
      name: row.name,
      description: row.description,
      riskLevel: row.riskLevel,
      latestVersion: row.Versions[0]?.version ?? null,
      steps: row.Versions[0]?.Steps ?? []
    }))
  );
};

export const getAutomationRun = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const run = await prisma.automationRun.findFirst({
    where: { id: req.params.runId, organizationId: orgId },
    include: {
      Steps: { orderBy: { stepOrder: "asc" } },
      Version: { include: { Playbook: true } },
      Approvals: { orderBy: { createdAt: "desc" }, take: 1 },
      Outcomes: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });
  if (!run) {
    res.status(404).json({ error: "Automation run not found" });
    return;
  }

  const latestApproval = run.Approvals[0];
  const latestOutcome = run.Outcomes[0];
  const plan = run.planJson as {
    steps?: Array<{
      order: number;
      action: string;
      approvalRequired: boolean;
      targetServiceName?: string;
      description: string;
    }>;
  };

  res.json({
    id: run.id,
    incidentId: run.incidentId,
    playbookKey: run.Version.Playbook.key,
    playbookVersion: run.Version.version,
    executionMode: run.executionMode,
    status: run.status,
    riskLevel: run.riskLevel,
    reason: run.reason,
    currentStepOrder: run.currentStepOrder,
    approvedBy: run.approvedBy,
    approvedAt: run.approvedAt,
    approvalReason: latestApproval?.reason ?? null,
    approvalDecision: latestApproval?.decision ?? null,
    plan: run.planJson,
    steps: run.Steps.map((step) => {
      const planStep = plan.steps?.find((row) => row.order === step.stepOrder);
      return {
        ...step,
        targetServiceName: planStep?.targetServiceName,
        description: planStep?.description,
        rollbackAvailable: step.action === "REVIEW_HTTP_EXPECTED_STATUS"
      };
    }),
    outcome: latestOutcome
      ? {
          summary: latestOutcome.summary,
          success: latestOutcome.success,
          details: latestOutcome.detailsJson
        }
      : null,
    permissions: {
      canApprove: hasPermission(req.user?.role, "automation:plan:approve")
    }
  });
};

export const approveAutomationRunHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:approve")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const approved = req.body?.approved === true;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!approved) {
    res.status(400).json({ error: "approved must be true" });
    return;
  }
  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  try {
    const result = await approveAutomationRun({
      organizationId: orgId,
      runId: String(req.params.runId),
      approvedBy: typeof req.user?.sub === "string" ? req.user.sub : "operator",
      reason
    });
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to approve automation run" });
  }
};

export const rejectAutomationRunHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:approve")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!reason) {
    res.status(400).json({ error: "reason is required" });
    return;
  }

  try {
    await rejectAutomationRun({
      organizationId: orgId,
      runId: String(req.params.runId),
      rejectedBy: typeof req.user?.sub === "string" ? req.user.sub : "operator",
      reason
    });
    res.json({ runId: req.params.runId, status: "REJECTED" });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to reject automation run" });
  }
};

export const cancelAutomationRunHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;

  const canCancel =
    hasPermission(req.user?.role, "automation:plan:approve") ||
    hasPermission(req.user?.role, "automation:plan:observe");
  if (!canCancel) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined;
  try {
    await cancelAutomationRun({
      organizationId: orgId,
      runId: String(req.params.runId),
      cancelledBy: typeof req.user?.sub === "string" ? req.user.sub : "operator",
      reason
    });
    res.json({ runId: req.params.runId, status: "CANCELLED" });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to cancel automation run" });
  }
};

const ACTIVE_REMEDIATION_STATUSES = ["APPROVED", "EXECUTING", "VERIFYING"] as const;

/** Active remediating/verifying runs for topology amber-pulse + recovery UX. */
export const listProjectActiveAutomationRuns = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const projectId = String(req.params.projectId || "");
  if (!projectId) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId: orgId },
    select: { id: true }
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const runs = await prisma.automationRun.findMany({
    where: {
      organizationId: orgId,
      projectId,
      status: { in: [...ACTIVE_REMEDIATION_STATUSES] }
    },
    include: {
      Steps: { select: { targetServiceId: true, status: true } }
    },
    orderBy: { updatedAt: "desc" },
    take: 50
  });

  res.json(
    runs.map((run) => {
      const affected = Array.isArray(run.affectedServiceIds)
        ? (run.affectedServiceIds as unknown[]).filter((id): id is string => typeof id === "string")
        : [];
      const targetServiceIds = [
        ...new Set(
          run.Steps.map((step) => step.targetServiceId).filter(
            (id): id is string => typeof id === "string" && id.length > 0
          )
        )
      ];
      return {
        id: run.id,
        incidentId: run.incidentId,
        status: run.status,
        affectedServiceIds: affected,
        targetServiceIds
      };
    })
  );
};

export const requestAutomationApprovalHandler = async (
  req: AuthRequest,
  res: Response
): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    await requestAutomationApproval({
      organizationId: orgId,
      runId: String(req.params.runId),
      requestedBy: typeof req.user?.sub === "string" ? req.user.sub : "responder"
    });
    res.json({ runId: req.params.runId, status: "APPROVAL_PENDING" });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Unable to request approval" });
  }
};

export const postAutomationTestModeHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const orgId = orgIdOr403(req, res);
  if (!orgId) return;
  if (!hasPermission(req.user?.role, "automation:plan:observe")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const action = typeof req.body?.action === "string" ? req.body.action : "";
  if (!action || !(action in REMEDIATION_REGISTRY)) {
    res.status(400).json({ error: "Valid remediation action is required" });
    return;
  }

  const result = runAutomationTestMode(action as RemediationAction);
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: typeof req.user?.sub === "string" ? req.user.sub : null,
      action: "AUTOMATION_TEST_MODE",
      entityType: "RemediationAction",
      entityId: action,
      metadataJson: {
        organizationId: orgId,
        ...result
      }
    }
  });
  res.json(result);
};
