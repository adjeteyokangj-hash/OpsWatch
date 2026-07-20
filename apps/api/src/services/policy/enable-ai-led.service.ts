import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  AUTO_RUN_ALLOWLIST,
  checkAutoRunPolicy
} from "../remediation/auto-run-policy.service";
import type { RemediationAction } from "../remediation/actions";
import { buildIncidentDiagnosis } from "../remediation/remediation-suggest.service";
import {
  defaultAiAutomationPolicyDocument,
  type AiAutomationPolicyDocument,
  type AiOperatingProfileId
} from "./policy-document";

const TEST_PROJECT_PATTERN = /TEST ONLY|pw-|test-/i;
const LOW_AUTOMATION_MODES = new Set(["MONITOR_ONLY", "OBSERVE", "DISABLED"]);

export type ReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  href: string;
};

export type AiLedReadinessResult = {
  ready: boolean;
  items: ReadinessItem[];
};

const isProductionProject = (project: { name: string; slug: string }): boolean =>
  !TEST_PROJECT_PATTERN.test(project.name) && !TEST_PROJECT_PATTERN.test(project.slug);

const configJsonContainsRemediator = (configJson: unknown): boolean => {
  if (!configJson || typeof configJson !== "object") return false;
  return Object.keys(configJson as Record<string, unknown>).some((key) =>
    key.toUpperCase().includes("REMEDIATOR")
  );
};

export const assessAiLedReadiness = async (
  organizationId: string
): Promise<AiLedReadinessResult> => {
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);

  const [
    recentHeartbeat,
    checkCount,
    notificationChannel,
    remediatorCandidates,
    approvedPlaybookVersion,
    checksWithDefaultRecovery,
    productionProjectCount
  ] = await Promise.all([
    prisma.heartbeat.findFirst({
      where: {
        receivedAt: { gte: twentyMinutesAgo },
        Project: { organizationId }
      },
      orderBy: { receivedAt: "desc" },
      select: { id: true }
    }),
    prisma.check.count({
      where: {
        isActive: true,
        Service: { Project: { organizationId } }
      }
    }),
    prisma.notificationChannel.findFirst({
      where: {
        isActive: true,
        Project: { organizationId }
      },
      select: { id: true }
    }),
    prisma.projectIntegration.findMany({
      where: {
        enabled: true,
        Project: { organizationId }
      },
      select: { id: true, configJson: true, type: true },
      take: 100
    }),
    prisma.automationPlaybookVersion.findFirst({
      where: {
        status: "APPROVED",
        Playbook: { isActive: true }
      },
      select: { id: true }
    }),
    prisma.check.findFirst({
      where: {
        isActive: true,
        recoveryThreshold: { gte: 2 },
        Service: { Project: { organizationId } }
      },
      select: { id: true }
    }),
    prisma.project.count({
      where: { organizationId, isActive: true }
    })
  ]);

  const remediatorIntegration = remediatorCandidates.find(
    (row) =>
      ["WORKER_PROVIDER", "SERVICE_PROVIDER", "DEPLOYMENT_PROVIDER"].includes(row.type) ||
      configJsonContainsRemediator(row.configJson)
  );

  const hasRemediator = remediatorIntegration != null;
  const items: ReadinessItem[] = [
    {
      id: "recent-heartbeat",
      label: "Recent heartbeat (<20 min)",
      ok: recentHeartbeat != null,
      href: "/projects"
    },
    {
      id: "checks-configured",
      label: "Health checks configured",
      ok: checkCount > 0,
      href: "/checks"
    },
    {
      id: "notification-channel",
      label: "Notification channel configured",
      ok: notificationChannel != null,
      href: "/settings/notifications"
    },
    {
      id: "remediator-integration",
      label: "Remediator integration configured",
      ok: hasRemediator,
      href: "/settings/integrations"
    },
    {
      id: "approved-playbook",
      label: "Approved playbook version",
      ok: approvedPlaybookVersion != null,
      href: "/settings/playbooks"
    },
    {
      id: "recovery-thresholds",
      label: "Recovery threshold defaults (>=2)",
      ok: checksWithDefaultRecovery != null,
      href: "/checks"
    },
    {
      id: "emergency-stop",
      label: "Emergency stop field available",
      ok: productionProjectCount > 0,
      href: "/settings/ai-automation-policies"
    }
  ];

  return {
    ready: items.every((item) => item.ok),
    items
  };
};

const nextBundleVersion = async (
  tx: Prisma.TransactionClient,
  bundleId: string
): Promise<number> => {
  const latest = await tx.aiAutomationPolicyRevision.findFirst({
    where: { bundleId },
    orderBy: { version: "desc" },
    select: { version: true }
  });
  return (latest?.version ?? 0) + 1;
};

export const enableAiLedSafeOperations = async (input: {
  organizationId: string;
  actorUserId: string;
  projectIds?: string[];
}) => {
  const { organizationId, actorUserId, projectIds } = input;
  const document = defaultAiAutomationPolicyDocument("AI_LED_SAFE");
  const allowlistActions = Array.from(AUTO_RUN_ALLOWLIST);

  const result = await prisma.$transaction(async (tx) => {
    await tx.automationPolicy.upsert({
      where: {
        organizationId_policyKey: { organizationId, policyKey: "GLOBAL" }
      },
      create: {
        id: randomUUID(),
        organizationId,
        policyKey: "GLOBAL",
        enabled: true,
        executionMode: "AUTO_HEAL_SAFE",
        updatedBy: actorUserId,
        updatedAt: new Date()
      },
      update: {
        enabled: true,
        executionMode: "AUTO_HEAL_SAFE",
        updatedBy: actorUserId,
        updatedAt: new Date()
      }
    });

    await tx.autoRemediationPolicy.upsert({
      where: {
        organizationId_policyType_policyKey: {
          organizationId,
          policyType: "GLOBAL",
          policyKey: ""
        }
      },
      create: {
        id: randomUUID(),
        organizationId,
        policyType: "GLOBAL",
        policyKey: "",
        enabled: true,
        updatedBy: actorUserId,
        updatedAt: new Date()
      },
      update: {
        enabled: true,
        updatedBy: actorUserId,
        updatedAt: new Date()
      }
    });

    const projects = await tx.project.findMany({
      where: {
        organizationId,
        isActive: true,
        ...(projectIds?.length ? { id: { in: projectIds } } : {})
      },
      select: { id: true, name: true, slug: true, automationMode: true }
    });

    const productionProjects = projects.filter(isProductionProject);
    let projectsModeUpgraded = 0;

    for (const project of productionProjects) {
      await tx.autoRemediationPolicy.upsert({
        where: {
          organizationId_policyType_policyKey: {
            organizationId,
            policyType: "PROJECT",
            policyKey: project.id
          }
        },
        create: {
          id: randomUUID(),
          organizationId,
          policyType: "PROJECT",
          policyKey: project.id,
          enabled: true,
          updatedBy: actorUserId,
          updatedAt: new Date()
        },
        update: {
          enabled: true,
          updatedBy: actorUserId,
          updatedAt: new Date()
        }
      });

      const normalizedMode = project.automationMode.trim().toUpperCase();
      if (LOW_AUTOMATION_MODES.has(normalizedMode)) {
        await tx.project.update({
          where: { id: project.id },
          data: {
            automationMode: "AUTO_HEAL_SAFE",
            updatedAt: new Date()
          }
        });
        projectsModeUpgraded += 1;
      }
    }

    for (const action of allowlistActions) {
      await tx.autoRemediationPolicy.upsert({
        where: {
          organizationId_policyType_policyKey: {
            organizationId,
            policyType: "ACTION",
            policyKey: action
          }
        },
        create: {
          id: randomUUID(),
          organizationId,
          policyType: "ACTION",
          policyKey: action,
          enabled: true,
          updatedBy: actorUserId,
          updatedAt: new Date()
        },
        update: {
          enabled: true,
          updatedBy: actorUserId,
          updatedAt: new Date()
        }
      });
    }

    const existingBundle = await tx.aiAutomationPolicyBundle.findUnique({
      where: { organizationId }
    });
    const beforeJson = (existingBundle?.documentJson as AiAutomationPolicyDocument | null) ?? null;

    const bundle = await tx.aiAutomationPolicyBundle.upsert({
      where: { organizationId },
      create: {
        id: randomUUID(),
        organizationId,
        operatingProfile: "AI_LED_SAFE",
        status: "ACTIVE",
        documentJson: document as unknown as Prisma.InputJsonValue,
        ownerUserId: actorUserId,
        activatedAt: new Date(),
        updatedAt: new Date()
      },
      update: {
        operatingProfile: "AI_LED_SAFE",
        status: "ACTIVE",
        documentJson: document as unknown as Prisma.InputJsonValue,
        ownerUserId: actorUserId,
        activatedAt: new Date(),
        updatedAt: new Date()
      }
    });

    const version = await nextBundleVersion(tx, bundle.id);
    await tx.aiAutomationPolicyRevision.create({
      data: {
        id: randomUUID(),
        organizationId,
        bundleId: bundle.id,
        version,
        status: "ACTIVE",
        beforeJson: beforeJson === null ? undefined : (beforeJson as unknown as Prisma.InputJsonValue),
        afterJson: document as unknown as Prisma.InputJsonValue,
        reason: "Enable AI-led safe operations",
        actorUserId,
        activatedAt: new Date()
      }
    });

    await tx.aiPolicyAuditEvent.create({
      data: {
        id: randomUUID(),
        organizationId,
        bundleId: bundle.id,
        eventType: "enable_ai_led",
        summary: "Enabled AI-led safe operations profile",
        detailJson: {
          productionProjectsEnabled: productionProjects.length,
          projectsModeUpgraded,
          allowlistActions
        },
        actorUserId
      }
    });

    return {
      bundle,
      snapshotHints: {
        productionProjectsEnabled: productionProjects.length,
        skippedTestProjects: projects.length - productionProjects.length,
        projectsModeUpgraded,
        allowlistActionsSeeded: allowlistActions.length
      }
    };
  });

  const readiness = await assessAiLedReadiness(organizationId);
  const partiallyEnabled = !readiness.ready || result.snapshotHints.skippedTestProjects > 0;

  return {
    bundle: result.bundle,
    snapshotHints: result.snapshotHints,
    readiness,
    partiallyEnabled
  };
};

export const setOrganizationCeiling = async (input: {
  organizationId: string;
  executionMode: string;
  actorUserId: string;
  reason?: string;
}) => {
  const { organizationId, executionMode, actorUserId, reason } = input;

  return prisma.$transaction(async (tx) => {
    const policy = await tx.automationPolicy.upsert({
      where: {
        organizationId_policyKey: { organizationId, policyKey: "GLOBAL" }
      },
      create: {
        id: randomUUID(),
        organizationId,
        policyKey: "GLOBAL",
        enabled: true,
        executionMode,
        updatedBy: actorUserId,
        updatedAt: new Date()
      },
      update: {
        executionMode,
        updatedBy: actorUserId,
        updatedAt: new Date()
      }
    });

    const bundle = await tx.aiAutomationPolicyBundle.findUnique({
      where: { organizationId }
    });

    if (bundle) {
      const document = {
        ...(bundle.documentJson as AiAutomationPolicyDocument),
        areas: {
          ...(bundle.documentJson as AiAutomationPolicyDocument).areas,
          autonomousExecution: {
            ...(bundle.documentJson as AiAutomationPolicyDocument).areas.autonomousExecution,
            orgCeilingMode: executionMode
          }
        }
      };

      const updatedBundle = await tx.aiAutomationPolicyBundle.update({
        where: { id: bundle.id },
        data: {
          documentJson: document as unknown as Prisma.InputJsonValue,
          updatedAt: new Date()
        }
      });

      const version = await nextBundleVersion(tx, bundle.id);
      await tx.aiAutomationPolicyRevision.create({
        data: {
          id: randomUUID(),
          organizationId,
          bundleId: bundle.id,
          version,
          status: "ACTIVE",
          beforeJson: bundle.documentJson ?? undefined,
          afterJson: document as unknown as Prisma.InputJsonValue,
          reason: reason ?? `Organization ceiling set to ${executionMode}`,
          actorUserId,
          activatedAt: new Date()
        }
      });

      await tx.aiPolicyAuditEvent.create({
        data: {
          id: randomUUID(),
          organizationId,
          bundleId: bundle.id,
          eventType: "set_org_ceiling",
          summary: `Organization automation ceiling set to ${executionMode}`,
          detailJson: { executionMode, reason: reason ?? null },
          actorUserId
        }
      });

      return { policy, bundle: updatedBundle };
    }

    await tx.aiPolicyAuditEvent.create({
      data: {
        id: randomUUID(),
        organizationId,
        eventType: "set_org_ceiling",
        summary: `Organization automation ceiling set to ${executionMode}`,
        detailJson: { executionMode, reason: reason ?? null },
        actorUserId
      }
    });

    return { policy, bundle: null };
  });
};

export const setEmergencyStop = async (input: {
  organizationId: string;
  projectId: string;
  disabled: boolean;
  actorUserId: string;
  reason: string;
}) => {
  const { organizationId, projectId, disabled, actorUserId, reason } = input;

  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { id: true, name: true, remediationEmergencyDisabled: true }
  });
  if (!project) {
    throw new Error("Project not found");
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      remediationEmergencyDisabled: disabled,
      updatedAt: new Date()
    }
  });

  const bundle = await prisma.aiAutomationPolicyBundle.findUnique({
    where: { organizationId },
    select: { id: true }
  });

  await prisma.aiPolicyAuditEvent.create({
    data: {
      id: randomUUID(),
      organizationId,
      bundleId: bundle?.id,
      eventType: disabled ? "emergency_stop_enabled" : "emergency_stop_cleared",
      summary: disabled
        ? `Emergency stop enabled for ${project.name}`
        : `Emergency stop cleared for ${project.name}`,
      detailJson: { projectId, disabled, reason },
      actorUserId
    }
  });

  return updated;
};

export const rollbackPolicyRevision = async (input: {
  organizationId: string;
  revisionId: string;
  actorUserId: string;
}) => {
  const { organizationId, revisionId, actorUserId } = input;

  return prisma.$transaction(async (tx) => {
    const revision = await tx.aiAutomationPolicyRevision.findFirst({
      where: { id: revisionId, organizationId },
      include: { Bundle: true }
    });
    if (!revision?.Bundle) {
      throw new Error("Policy revision not found");
    }

    const restoreDocument =
      (revision.beforeJson as AiAutomationPolicyDocument | null) ??
      (revision.afterJson as AiAutomationPolicyDocument);

    const bundle = await tx.aiAutomationPolicyBundle.update({
      where: { id: revision.bundleId },
      data: {
        documentJson: restoreDocument as unknown as Prisma.InputJsonValue,
        operatingProfile: restoreDocument.areas.operatingProfile.profile as AiOperatingProfileId,
        updatedAt: new Date()
      }
    });

    const version = await nextBundleVersion(tx, bundle.id);
    const rollbackRevision = await tx.aiAutomationPolicyRevision.create({
      data: {
        id: randomUUID(),
        organizationId,
        bundleId: bundle.id,
        version,
        status: "ACTIVE",
        beforeJson: (revision.Bundle.documentJson as unknown as Prisma.InputJsonValue) ?? undefined,
        afterJson: restoreDocument as unknown as Prisma.InputJsonValue,
        reason: `Rollback to revision v${revision.version}`,
        actorUserId,
        supersedesId: revision.id,
        activatedAt: new Date()
      }
    });

    await tx.aiPolicyAuditEvent.create({
      data: {
        id: randomUUID(),
        organizationId,
        bundleId: bundle.id,
        eventType: "rollback_policy_revision",
        summary: `Rolled back to policy revision v${revision.version}`,
        detailJson: { revisionId, rollbackRevisionId: rollbackRevision.id },
        actorUserId
      }
    });

    return { bundle, revision: rollbackRevision };
  });
};

export const simulateAiOperations = async (input: {
  organizationId: string;
  projectId?: string;
}) => {
  const { organizationId, projectId } = input;

  const incidents = await prisma.incident.findMany({
    where: {
      status: "OPEN",
      Project: {
        organizationId,
        ...(projectId ? { id: projectId } : {})
      }
    },
    orderBy: { openedAt: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      severity: true,
      openedAt: true,
      projectId: true,
      Project: { select: { name: true } }
    }
  });

  const simulations = [];

  for (const incident of incidents) {
    const diagnosis = await buildIncidentDiagnosis(organizationId, {
      incidentId: incident.id
    });
    const candidateActions: Array<{
      action: RemediationAction;
      label: string;
      autoRunEligible: boolean;
      policyAllowed: boolean;
    }> = [];

    for (const suggested of diagnosis?.suggestedActions ?? []) {
      if (!AUTO_RUN_ALLOWLIST.has(suggested.action)) continue;

      const policy = await checkAutoRunPolicy(
        organizationId,
        suggested.action,
        incident.projectId
      );

      candidateActions.push({
        action: suggested.action,
        label: suggested.label,
        autoRunEligible: suggested.autoRunEligible,
        policyAllowed: policy.allowed
      });
    }

    simulations.push({
      incidentId: incident.id,
      title: incident.title,
      severity: incident.severity,
      openedAt: incident.openedAt,
      projectId: incident.projectId,
      projectName: incident.Project.name,
      candidateActions
    });
  }

  return {
    simulatedAt: new Date().toISOString(),
    incidentCount: simulations.length,
    allowlist: Array.from(AUTO_RUN_ALLOWLIST),
    incidents: simulations
  };
};
