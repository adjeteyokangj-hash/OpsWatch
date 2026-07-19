/**
 * After verified recovery, resolve contributing alerts only when recovery rules pass.
 * Keep incidents open if other contributing alerts remain.
 */
import { randomUUID } from "crypto";
import { AlertStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { redactUnknown } from "../../lib/redact-secrets";

export type RecoveryCause =
  | "automatic"
  | "administrator-approved"
  | "manual-external"
  | "natural";

export const applyVerifiedRecoveryResolution = async (input: {
  organizationId: string;
  projectId?: string | null;
  alertId?: string | null;
  incidentId?: string | null;
  correlationId: string;
  recoveryCause: RecoveryCause;
  verificationState: "VERIFIED_HEALTHY" | "PARTIALLY_RECOVERED" | "VERIFICATION_FAILED";
  actorUserId?: string | null;
}): Promise<{
  alertResolved: boolean;
  incidentResolved: boolean;
  incidentStillOpenReason: string | null;
}> => {
  if (input.verificationState !== "VERIFIED_HEALTHY") {
    if (input.incidentId) {
      await prisma.incidentTimelineEvent.create({
        data: {
          id: randomUUID(),
          incidentId: input.incidentId,
          projectId: input.projectId ?? "",
          eventType: "REMEDIATION",
          summary:
            input.verificationState === "VERIFICATION_FAILED"
              ? "Remediation verification failed — alert kept open; escalation recommended"
              : "Partial recovery — alert kept open pending full verification",
          sourceType: "REMEDIATION_EXECUTION_RUN",
          sourceId: input.correlationId,
          payloadJson: redactUnknown({
            correlationId: input.correlationId,
            verificationState: input.verificationState,
            recoveryCause: input.recoveryCause
          }) as object
        }
      }).catch(() => undefined);
    }
    return {
      alertResolved: false,
      incidentResolved: false,
      incidentStillOpenReason:
        input.verificationState === "VERIFICATION_FAILED"
          ? "Verification failed"
          : "Only partial recovery observed"
    };
  }

  let alertResolved = false;
  if (input.alertId) {
    const alert = await prisma.alert.findFirst({
      where: {
        id: input.alertId,
        Project: { organizationId: input.organizationId }
      }
    });
    if (alert && alert.status !== AlertStatus.RESOLVED) {
      await prisma.alert.update({
        where: { id: alert.id },
        data: {
          status: AlertStatus.RESOLVED,
          resolvedAt: new Date(),
          message: `${alert.message} [auto-resolved: verified remediation recovery; cause=${input.recoveryCause}; correlationId=${input.correlationId}]`
        }
      });
      alertResolved = true;
      await prisma.auditLog.create({
        data: {
          id: randomUUID(),
          userId: input.actorUserId ?? null,
          action: "ALERT_RESOLVED_AFTER_VERIFIED_RECOVERY",
          entityType: "ALERT",
          entityId: alert.id,
          metadataJson: redactUnknown({
            correlationId: input.correlationId,
            recoveryCause: input.recoveryCause
          }) as object
        }
      });
    }
  }

  let incidentResolved = false;
  let incidentStillOpenReason: string | null = null;
  if (input.incidentId) {
    const incident = await prisma.incident.findFirst({
      where: { id: input.incidentId, Project: { organizationId: input.organizationId } },
      include: { IncidentAlert: { include: { Alert: true } } }
    });
    if (incident) {
      const openAlerts = incident.IncidentAlert.filter(
        (row) => row.Alert.status !== AlertStatus.RESOLVED && row.Alert.id !== input.alertId
      );
      // If we just resolved the target alert, exclude it from remaining open set.
      const remainingOpen = incident.IncidentAlert.filter((row) => {
        if (row.Alert.id === input.alertId && alertResolved) return false;
        return row.Alert.status !== AlertStatus.RESOLVED;
      });

      await prisma.incidentTimelineEvent.create({
        data: {
          id: randomUUID(),
          incidentId: incident.id,
          projectId: incident.projectId,
          eventType: "REMEDIATION",
          summary: alertResolved
            ? `Contributing alert resolved after verified recovery (${input.recoveryCause})`
            : "Verified recovery recorded",
          sourceType: "REMEDIATION_EXECUTION_RUN",
          sourceId: input.correlationId,
          payloadJson: redactUnknown({
            correlationId: input.correlationId,
            recoveryCause: input.recoveryCause,
            remainingOpenAlerts: remainingOpen.length
          }) as object
        }
      });

      if (remainingOpen.length === 0 && incident.status !== "RESOLVED") {
        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            status: "RESOLVED",
            resolvedAt: new Date(),
            resolutionNotes: `Resolved after verified remediation recovery (${input.recoveryCause}); correlationId=${input.correlationId}`
          }
        });
        incidentResolved = true;
      } else if (remainingOpen.length > 0) {
        incidentStillOpenReason = `${remainingOpen.length} contributing alert(s) remain open`;
        await prisma.incident.update({
          where: { id: incident.id },
          data: {
            // Keep open / investigating; impact note via timeline only.
          }
        });
        void openAlerts;
      }
    }
  }

  return { alertResolved, incidentResolved, incidentStillOpenReason };
};
