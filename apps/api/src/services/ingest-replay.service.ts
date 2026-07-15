import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type IngestRoute = "event" | "health-snapshot" | "heartbeat" | "connection-event" | "otel-bridge";

const DEFAULT_NONCE_TTL_SECONDS = 86_400;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const acceptIngestNonce = async (input: {
  nonce: string;
  route: IngestRoute;
  projectId?: string;
  apiKeyId?: string;
  ttlSeconds?: number;
}): Promise<"accepted" | "replay"> => {
  const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? DEFAULT_NONCE_TTL_SECONDS) * 1000);

  try {
    await prisma.ingestReplayNonce.create({
      data: {
        nonce: input.nonce,
        route: input.route,
        projectId: input.projectId,
        apiKeyId: input.apiKeyId,
        expiresAt
      }
    });
    return "accepted";
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return "replay";
    }
    throw error;
  }
};
