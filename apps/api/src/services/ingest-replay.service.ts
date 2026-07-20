import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

export type IngestRoute =
  | "event"
  | "health-snapshot"
  | "heartbeat"
  | "connection-event"
  | "otel-bridge"
  | "security-events"
  | "security-events-batch";

const DEFAULT_NONCE_TTL_SECONDS = 86_400;

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

export const acceptIngestNonce = async (input: {
  nonce: string;
  route: IngestRoute;
  projectId?: string;
  apiKeyId?: string;
  connectionId?: string;
  ttlSeconds?: number;
}): Promise<"accepted" | "replay"> => {
  const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? DEFAULT_NONCE_TTL_SECONDS) * 1000);
  const scopedNonce = input.connectionId
    ? `${input.route}:${input.connectionId}:${input.nonce}`
    : input.nonce;

  try {
    await prisma.ingestReplayNonce.create({
      data: {
        nonce: scopedNonce,
        route: input.route,
        projectId: input.projectId,
        apiKeyId: input.apiKeyId,
        connectionId: input.connectionId,
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

export const pruneExpiredIngestNonces = async (limit = 1_000): Promise<number> => {
  const expired = await prisma.ingestReplayNonce.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { nonce: true },
    take: limit
  });
  if (expired.length === 0) return 0;
  const result = await prisma.ingestReplayNonce.deleteMany({
    where: { nonce: { in: expired.map((row) => row.nonce) } }
  });
  return result.count;
};
