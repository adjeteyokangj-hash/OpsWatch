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

export const ingestHeartbeat = async (projectId: string, body: any): Promise<void> => {
  await prisma.heartbeat.create({
    data: {
      id: randomUUID(),
      projectId,
      environment: body.environment,
      appVersion: body.appVersion,
      commitSha: body.commitSha,
      status: body.status,
      message: body.message,
      payloadJson: body.payload
    }
  });

  const project = await prisma.project.update({
    where: { id: projectId },
    data: {
      status: body.status === "DOWN" ? ProjectStatus.DOWN : ProjectStatus.HEALTHY
    },
    select: { id: true, organizationId: true }
  });

  if (project.organizationId) {
    const isDown = body.status === "DOWN";
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
