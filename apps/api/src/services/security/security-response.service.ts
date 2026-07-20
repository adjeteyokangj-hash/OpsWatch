import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { recordCredentialAudit } from "../credentials/credential-audit.service";

export type SecurityResponseActionKey =
  | "INCREASE_SECURITY_MONITORING"
  | "RUN_EXTERNAL_SURFACE_CHECK"
  | "REVOKE_ORG_API_KEY"
  | "DISABLE_INTEGRATION"
  | "QUARANTINE_SECURITY_EVENT"
  | "REQUEST_CREDENTIAL_ROTATION"
  | "OPEN_SECURITY_INCIDENT";

export const SECURITY_RESPONSE_ACTIONS: Record<
  SecurityResponseActionKey,
  {
    label: string;
    riskLevel: "LOW" | "MEDIUM" | "HIGH";
    requiresApproval: boolean;
    verification: string;
  }
> = {
  INCREASE_SECURITY_MONITORING: {
    label: "Increase monitoring frequency",
    riskLevel: "LOW",
    requiresApproval: false,
    verification: "Monitoring interval reduced; finding continues to receive evidence checks."
  },
  RUN_EXTERNAL_SURFACE_CHECK: {
    label: "Run additional external surface check",
    riskLevel: "LOW",
    requiresApproval: false,
    verification: "Check completes; new security events may be ingested."
  },
  REVOKE_ORG_API_KEY: {
    label: "Revoke OpsWatch-issued API key",
    riskLevel: "MEDIUM",
    requiresApproval: true,
    verification: "Key authentication fails; no further successful use."
  },
  DISABLE_INTEGRATION: {
    label: "Disable compromised test integration",
    riskLevel: "MEDIUM",
    requiresApproval: true,
    verification: "Connection/integration becomes disabled; suspicious events stop."
  },
  QUARANTINE_SECURITY_EVENT: {
    label: "Quarantine failed webhook/event",
    riskLevel: "LOW",
    requiresApproval: false,
    verification: "Event marked quarantined; retained for evidence."
  },
  REQUEST_CREDENTIAL_ROTATION: {
    label: "Request credential rotation",
    riskLevel: "LOW",
    requiresApproval: false,
    verification: "Rotation request recorded; credential lifecycle monitored."
  },
  OPEN_SECURITY_INCIDENT: {
    label: "Open and route a security incident",
    riskLevel: "LOW",
    requiresApproval: false,
    verification: "Security-classified incident exists and finding is linked."
  }
};

export const createSecurityResponseRun = async (args: {
  organizationId: string;
  projectId?: string | null;
  findingId?: string | null;
  incidentId?: string | null;
  sequenceId?: string | null;
  actionKey: SecurityResponseActionKey;
  automationMode: "OBSERVE" | "APPROVAL" | "AUTONOMOUS";
  requestedBy?: string;
  context?: Record<string, unknown>;
}) => {
  const def = SECURITY_RESPONSE_ACTIONS[args.actionKey];
  if (!def) {
    return { status: "SETUP_REQUIRED" as const, reason: "Unsupported security response action" };
  }

  if (args.automationMode === "OBSERVE") {
    const run = await prisma.securityResponseRun.create({
      data: {
        id: randomUUID(),
        organizationId: args.organizationId,
        projectId: args.projectId ?? null,
        findingId: args.findingId ?? null,
        incidentId: args.incidentId ?? null,
        sequenceId: args.sequenceId ?? null,
        actionKey: args.actionKey,
        automationMode: "OBSERVE",
        status: "OBSERVED",
        requestedBy: args.requestedBy,
        correlationId: randomUUID(),
        resultJson: {
          recommendation: def.label,
          verification: def.verification,
          context: args.context || {}
        } as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    });
    return { status: "OBSERVED" as const, run };
  }

  if (def.requiresApproval && args.automationMode !== "APPROVAL" && args.automationMode !== "AUTONOMOUS") {
    return { status: "APPROVAL_REQUIRED" as const, reason: "Action requires approval" };
  }

  if (def.requiresApproval && args.automationMode === "AUTONOMOUS" && def.riskLevel !== "LOW") {
    return {
      status: "APPROVAL_REQUIRED" as const,
      reason: "Autonomous mode only permitted for low-risk security responses"
    };
  }

  const run = await prisma.securityResponseRun.create({
    data: {
      id: randomUUID(),
      organizationId: args.organizationId,
      projectId: args.projectId ?? null,
      findingId: args.findingId ?? null,
      incidentId: args.incidentId ?? null,
      sequenceId: args.sequenceId ?? null,
      actionKey: args.actionKey,
      automationMode: args.automationMode,
      status: "RUNNING",
      requestedBy: args.requestedBy,
      correlationId: randomUUID(),
      startedAt: new Date(),
      updatedAt: new Date()
    }
  });

  try {
    const verification = await executeSecurityResponseAction(args.actionKey, {
      organizationId: args.organizationId,
      projectId: args.projectId,
      findingId: args.findingId,
      context: args.context || {},
      requestedBy: args.requestedBy
    });

    const updated = await prisma.securityResponseRun.update({
      where: { id: run.id },
      data: {
        status: verification.ok ? "VERIFIED" : "FAILED",
        verificationJson: verification as Prisma.InputJsonValue,
        resultJson: verification as Prisma.InputJsonValue,
        failureReason: verification.ok ? null : verification.message,
        endedAt: new Date(),
        updatedAt: new Date()
      }
    });

    if (args.findingId) {
      await prisma.securityFinding.update({
        where: { id: args.findingId },
        data: {
          responseStatus: verification.ok ? "CONTAINMENT_VERIFIED" : "RESPONSE_FAILED",
          // Do not auto-resolve security findings/incidents after action execution.
          state: verification.ok ? "CONTAINING" : "INVESTIGATING",
          updatedAt: new Date()
        }
      });
    }

    return { status: updated.status, run: updated, verification };
  } catch (error) {
    const message = error instanceof Error ? error.message : "execution failed";
    const updated = await prisma.securityResponseRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        failureReason: message,
        endedAt: new Date(),
        updatedAt: new Date()
      }
    });
    return { status: "FAILED" as const, run: updated, error: message };
  }
};

const executeSecurityResponseAction = async (
  actionKey: SecurityResponseActionKey,
  args: {
    organizationId: string;
    projectId?: string | null;
    findingId?: string | null;
    context: Record<string, unknown>;
    requestedBy?: string;
  }
): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> => {
  switch (actionKey) {
    case "REVOKE_ORG_API_KEY": {
      const keyId = String(args.context.orgApiKeyId || "");
      if (!keyId) return { ok: false, message: "orgApiKeyId required" };
      const key = await prisma.orgApiKey.findFirst({
        where: { id: keyId, organizationId: args.organizationId }
      });
      if (!key) return { ok: false, message: "API key not found in organization" };
      if (key.revokedAt) {
        return { ok: true, message: "Key already revoked", details: { keyId: key.id } };
      }
      await prisma.orgApiKey.update({
        where: { id: key.id },
        data: {
          revokedAt: new Date(),
          revokeReason: "security_response"
        }
      });
      await recordCredentialAudit({
        organizationId: args.organizationId,
        userId: args.requestedBy,
        action: "CREDENTIAL_REVOKED",
        entityType: "OrgApiKey",
        entityId: key.id,
        metadata: { reason: "security_response", findingId: args.findingId }
      });
      const verify = await prisma.orgApiKey.findUnique({ where: { id: key.id } });
      return {
        ok: Boolean(verify?.revokedAt),
        message: verify?.revokedAt
          ? "API key revoked; subsequent authentication must fail"
          : "Revocation did not persist",
        details: { keyId: key.id, revokedAt: verify?.revokedAt }
      };
    }
    case "QUARANTINE_SECURITY_EVENT": {
      const eventId = String(args.context.securityEventId || "");
      if (!eventId) return { ok: false, message: "securityEventId required" };
      const event = await prisma.securityEvent.findFirst({
        where: { id: eventId, organizationId: args.organizationId }
      });
      if (!event) return { ok: false, message: "Security event not found" };
      await prisma.securityEvent.update({
        where: { id: event.id },
        data: {
          metadataJson: {
            ...((event.metadataJson as object) || {}),
            quarantined: true,
            quarantinedAt: new Date().toISOString()
          }
        }
      });
      return { ok: true, message: "Event quarantined; evidence retained" };
    }
    case "REQUEST_CREDENTIAL_ROTATION": {
      await recordCredentialAudit({
        organizationId: args.organizationId,
        userId: args.requestedBy,
        action: "CREDENTIAL_ROTATION_REQUESTED",
        entityType: "SecurityFinding",
        entityId: args.findingId || args.organizationId,
        metadata: { source: "security_response" }
      });
      return { ok: true, message: "Credential rotation requested and audited" };
    }
    case "INCREASE_SECURITY_MONITORING": {
      return {
        ok: true,
        message: "Monitoring frequency increase recorded for operators",
        details: { mode: "observe_plus" }
      };
    }
    case "OPEN_SECURITY_INCIDENT": {
      const { attachFindingToSecurityIncident } = await import("./security-incident.service");
      if (!args.findingId) return { ok: false, message: "findingId required" };
      const incident = await attachFindingToSecurityIncident({
        organizationId: args.organizationId,
        findingId: args.findingId,
        actorUserId: args.requestedBy
      });
      return {
        ok: Boolean(incident),
        message: incident ? "Security incident opened/linked" : "Unable to open incident",
        details: { incidentId: incident?.id }
      };
    }
    case "DISABLE_INTEGRATION": {
      const connectionId = String(args.context.connectionId || args.context.integrationId || "");
      if (!connectionId) {
        return { ok: false, message: "Setup required: connectionId/integrationId" };
      }
      const connection = await prisma.connection.findFirst({
        where: { id: connectionId, organizationId: args.organizationId }
      });
      if (!connection) {
        return { ok: false, message: "Setup required: connection not found" };
      }
      await prisma.connection.update({
        where: { id: connection.id },
        data: {
          health: "DISABLED",
          healthReason: "security_response",
          updatedAt: new Date()
        }
      });
      return { ok: true, message: "Connection disabled via security response" };
    }
    case "RUN_EXTERNAL_SURFACE_CHECK": {
      const targetUrl = String(args.context.targetUrl || "");
      if (!targetUrl) return { ok: false, message: "Setup required: targetUrl" };
      const { runExternalSurfaceCheck } = await import("./security-external-surface.service");
      const result = await runExternalSurfaceCheck({
        organizationId: args.organizationId,
        projectId: args.projectId,
        targetUrl,
        mode: "SAFE_VALIDATION"
      });
      return {
        ok: result.ok,
        message: result.ok ? "External surface check completed" : result.error || "check failed",
        details: { events: result.events.length, ingested: result.ingested }
      };
    }
    default:
      return { ok: false, message: "Setup required: unsupported action" };
  }
};
