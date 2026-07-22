import { ProjectStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { createAlert } from "./alerting.service";
import {
  recordObservation,
  recordOperationsTimelineEvent
} from "./intelligence/observation.service";
import { OBSERVATION_SOURCE, TIMELINE_EVENT } from "./intelligence/intelligence-constants";
import { progressHeartbeatAlertRecovery } from "./alert-automation-evaluation.service";
import { canonicalGraph } from "./canonical-graph.service";

export const projectStatusFromHeartbeat = (status: unknown): ProjectStatus => {
  if (status === "DOWN") return ProjectStatus.DOWN;
  if (status === "DEGRADED") return ProjectStatus.DEGRADED;
  if (status === "PAUSED") return ProjectStatus.PAUSED;
  return ProjectStatus.HEALTHY;
};

const canonicalHealthFromHeartbeat = (status: unknown): string => {
  if (status === "DOWN") return "DOWN";
  if (status === "DEGRADED") return "DEGRADED";
  if (status === "PAUSED") return "PAUSED";
  return "HEALTHY";
};

/**
 * TrueNumeris modules are declared logical areas inside one application process.
 * Until a module has its own checks/telemetry, the application heartbeat is the
 * only truthful liveness evidence. Only connection-discovered modules inherit it.
 */
export const inheritHeartbeatToDiscoveredModules = async (params: {
  projectId: string;
  organizationId: string | null;
  status: unknown;
  message?: string | null;
  observedAt?: Date;
}): Promise<number> => {
  const observedAt = params.observedAt ?? new Date();
  const status = projectStatusFromHeartbeat(params.status);
  const canonicalHealth = canonicalHealthFromHeartbeat(params.status);
  const modules = await prisma.service.findMany({
    where: {
      projectId: params.projectId,
      type: "MODULE",
      OutgoingDependencies: {
        some: {
          dependencyType: "HIERARCHY",
          source: "CONNECTION_DISCOVERY",
          isActive: true
        }
      }
    },
    select: { id: true }
  });

  const moduleIds = modules.map((module) => module.id);
  if (moduleIds.length === 0) return 0;

  await prisma.service.updateMany({
    where: { id: { in: moduleIds } },
    data: { status, updatedAt: observedAt }
  });

  if (params.organizationId) {
    await prisma.operationalEntity.updateMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        legacyServiceId: { in: moduleIds }
      },
      data: {
        health: canonicalHealth,
        healthReason:
          params.message ||
          `Inherited from application heartbeat (${String(params.status || "HEALTHY")})`,
        lastSeenAt: observedAt,
        freshUntil: new Date(observedAt.getTime() + 5 * 60_000),
        lastSignalKind: "APPLICATION_HEARTBEAT",
        signalCount: { increment: 1 },
        updatedAt: observedAt
      }
    });
  }

  return moduleIds.length;
};

export const ingestHeartbeat = async (projectId: string, body: any): Promise<void> => {
  const observedAt = new Date();
  await prisma.heartbeat.create({
    data: {
      id: randomUUID(),
      projectId,
      environment: body.environment,
      appVersion: body.appVersion,
      commitSha: body.commitSha,
      status: body.status,
      message: body.message,
      payloadJson: body.payload,
      receivedAt: observedAt
    }
  });

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      status: projectStatusFromHeartbeat(body.status)
    },
    select: { id: true, name: true, organizationId: true }
  });

  await inheritHeartbeatToDiscoveredModules({
    projectId,
    organizationId: project.organizationId,
    status: body.status,
    message: body.message,
    observedAt
  });

  if (project.organizationId) {
    const isDown = body.status === "DOWN";
    await canonicalGraph.upsertEntity({
      organizationId: project.organizationId,
      projectId,
      environment: body.environment || "unknown",
      entityType: "APP",
      stableKey: projectId,
      name: project.name,
      source: "HEARTBEAT",
      sourceKey: projectId,
      provenance: "DISCOVERED",
      health: canonicalHealthFromHeartbeat(body.status),
      healthReason: body.message || `Heartbeat reports ${body.status}`,
      observedAt,
      freshUntil: new Date(observedAt.getTime() + 5 * 60_000),
      confirmationState: "CONFIRMED"
    });
    try {
      await recordObservation({
        organizationId: project.organizationId,
        projectId,
        sourceType: OBSERVATION_SOURCE.HEARTBEAT,
        eventKey: isDown ? "heartbeat.lost" : "heartbeat.received",
        summary: isDown
          ? body.message || "Heartbeat reports DOWN"
          : `Heartbeat received (${body.environment || "unknown env"})`,
        severity: isDown ? "HIGH" : null,
        payloadJson: {
          environment: body.environment ?? null,
          appVersion: body.appVersion ?? null,
          commitSha: body.commitSha ?? null,
          status: body.status ?? null
        }
      });
      await recordOperationsTimelineEvent({
        organizationId: project.organizationId,
        projectId,
        eventType: isDown ? TIMELINE_EVENT.HEARTBEAT_LOST : TIMELINE_EVENT.HEARTBEAT_RECEIVED,
        summary: isDown
          ? "Heartbeat lost / DOWN reported"
          : "Heartbeat received",
        sourceType: "HEARTBEAT",
        sourceId: projectId,
        severity: isDown ? "HIGH" : null
      });
    } catch {
      // Observation must never block heartbeat ingest.
    }
  }

  if (body.status === "DOWN") {
    await createAlert({
      projectId,
      sourceType: "HEARTBEAT",
      severity: "HIGH",
      title: "Heartbeat reports DOWN",
      message: body.message || "Project heartbeat status is DOWN"
    });
    return;
  }

  await progressHeartbeatAlertRecovery(projectId);
};
