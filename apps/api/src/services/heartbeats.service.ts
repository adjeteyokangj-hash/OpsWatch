import { ProjectStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma";
import { createAlert, resolveAlertsBySourceType } from "./alerting.service";

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

  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: body.status === "DOWN" ? ProjectStatus.DOWN : ProjectStatus.HEALTHY
    }
  });

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

  await resolveAlertsBySourceType(projectId, "HEARTBEAT");
};
