import type { Request, Response } from "express";
import {
  parseIngestTimestampMs,
  verifyIngestSignature,
  type RawBodyRequest
} from "../lib/request-signature";
import { prisma } from "../lib/prisma";
import { acceptIngestNonce } from "../services/ingest-replay.service";
import {
  recordSignedConnectionEvent,
  resolveConnectionSecretReference
} from "../services/agentless-connection.service";

const signedEventKinds = new Set(["DEPLOYMENT", "CHANGE"]);
const timestampWindowMs = Number(process.env.INGEST_TIMESTAMP_WINDOW_SECONDS || 300) * 1000;

export const ingestSignedConnectionEvent = async (req: Request, res: Response) => {
  const connection = await prisma.connection.findFirst({
    where: { id: req.params.connectionId, mode: "WEBHOOK", isActive: true },
    select: {
      id: true,
      organizationId: true,
      projectId: true,
      name: true,
      mode: true,
      configurationJson: true,
      secretRef: true
    }
  });
  if (!connection) {
    res.status(404).json({ error: "Active signed-webhook connection not found" });
    return;
  }
  const secret = resolveConnectionSecretReference(connection.secretRef);
  if (!secret) {
    res.status(503).json({ error: "Connection signing secret reference is unavailable" });
    return;
  }
  const timestamp = req.header("x-opswatch-timestamp")?.trim();
  const nonce = req.header("x-opswatch-nonce")?.trim();
  const signature = req.header("x-opswatch-signature")?.trim();
  const rawBody = (req as Request & RawBodyRequest).rawBody;
  if (!timestamp || !nonce || !signature || !rawBody?.length) {
    res.status(401).json({ error: "Missing signed connection event headers or body" });
    return;
  }
  const timestampMs = parseIngestTimestampMs(timestamp);
  if (timestampMs === null || Math.abs(Date.now() - timestampMs) > timestampWindowMs) {
    res.status(401).json({ error: "Signed connection event timestamp is invalid or stale" });
    return;
  }
  if (!verifyIngestSignature(secret, rawBody, { timestamp, nonce, signature })) {
    res.status(401).json({ error: "Invalid signed connection event signature" });
    return;
  }
  if (await acceptIngestNonce({ nonce, route: "connection-event", projectId: connection.projectId ?? undefined }) === "replay") {
    res.status(409).json({ error: "Replayed signed connection event" });
    return;
  }
  const body = req.body ?? {};
  const kind = typeof body.kind === "string" ? body.kind.toUpperCase() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  const evidence = body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)
    ? body.evidence as Record<string, unknown>
    : undefined;
  if (!signedEventKinds.has(kind) || !summary) {
    res.status(400).json({ error: "Signed events require kind DEPLOYMENT or CHANGE and a summary" });
    return;
  }
  const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : undefined;
  if (occurredAt && Number.isNaN(occurredAt.getTime())) {
    res.status(400).json({ error: "occurredAt must be a valid date" });
    return;
  }
  const row = await recordSignedConnectionEvent(connection, {
    kind: kind as "DEPLOYMENT" | "CHANGE",
    summary,
    externalId: typeof body.externalId === "string" ? body.externalId : undefined,
    actor: typeof body.actor === "string" ? body.actor : undefined,
    evidence,
    occurredAt
  });
  res.status(202).json({ id: row.id, accepted: true });
};
