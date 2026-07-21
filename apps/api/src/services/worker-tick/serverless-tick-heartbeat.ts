/**
 * Serverless worker heartbeat.
 *
 * "Intelligence -> AI Operations Status" derives the "Worker heartbeat"
 * capability tone from the most recent `Heartbeat` row for the organization's
 * projects (see `ai-operations-status.service.ts` -> `toneFromHeartbeatAge`).
 * The continuous worker keeps that signal fresh by POSTing to `/heartbeat`
 * (HMAC-signed) which calls `ingestHeartbeat`.
 *
 * When only the serverless tick is running (no continuous worker), the tick
 * must keep the SAME signal fresh. Because the tick executes inside the API
 * process, it calls `ingestHeartbeat` directly for the self-monitor project
 * instead of making an HTTP round-trip.
 */

import { prisma } from "../../lib/prisma";
import { ingestHeartbeat } from "../heartbeats.service";

export interface HeartbeatPrisma {
  project: {
    findFirst(args: {
      where: { slug: string };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

const selfMonitorSlug = (env: NodeJS.ProcessEnv = process.env): string =>
  env.OPSWATCH_SELF_MONITOR_SLUG?.trim() || "opswatch-production";

const selfMonitorEnvironment = (env: NodeJS.ProcessEnv = process.env): string =>
  env.OPSWATCH_ENVIRONMENT?.trim() || env.NODE_ENV || "production";

/**
 * Record a HEALTHY heartbeat for the self-monitor project so the AI Operations
 * Status worker capability reflects the serverless tick as active.
 *
 * Best-effort: never throws — returns `false` if the self-monitor project is
 * absent or ingestion fails, so heartbeat problems never fail the tick.
 */
export const recordServerlessWorkerHeartbeat = async (
  deps: { prismaClient?: HeartbeatPrisma; ingest?: typeof ingestHeartbeat; env?: NodeJS.ProcessEnv } = {}
): Promise<boolean> => {
  const prismaClient = deps.prismaClient ?? (prisma as unknown as HeartbeatPrisma);
  const ingest = deps.ingest ?? ingestHeartbeat;
  const env = deps.env ?? process.env;

  try {
    const project = await prismaClient.project.findFirst({
      where: { slug: selfMonitorSlug(env) },
      select: { id: true }
    });
    if (!project) {
      return false;
    }

    await ingest(project.id, {
      environment: selfMonitorEnvironment(env),
      status: "HEALTHY",
      appVersion: "serverless-tick",
      message: "Serverless worker tick executed",
      payload: { component: "serverless-tick" }
    });
    return true;
  } catch {
    return false;
  }
};
