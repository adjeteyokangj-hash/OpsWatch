import { NextFunction, Request, Response } from "express";
import { INGEST_ERROR_CODES, NONCE_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "../config/constants";
import { logger } from "../config/logger";
import {
  parseIngestTimestampMs,
  RawBodyRequest,
  verifyIngestSignature
} from "../lib/request-signature";
import type { AuthRequest } from "./auth";
import { prisma } from "../lib/prisma";
import { acceptIngestNonce, type IngestRoute } from "../services/ingest-replay.service";

export type IngestRequest = AuthRequest & RawBodyRequest;

type IngestRejectionReason =
  | "signing_disabled"
  | "signing_unconfigured"
  | "headers_missing"
  | "project_missing"
  | "body_missing"
  | "timestamp_invalid"
  | "timestamp_stale"
  | "signature_invalid"
  | "replay_detected";

export const isIngestSigningRequired = (): boolean => process.env.INGEST_SIGNING_REQUIRED !== "false";

const ingestTimestampWindowMs = (): number =>
  Number(process.env.INGEST_TIMESTAMP_WINDOW_SECONDS || 300) * 1000;

const auditIngestRejection = (route: IngestRoute, reason: IngestRejectionReason, req: Request): void => {
  logger.warn("ingest-auth: rejected request", {
    route,
    reason,
    requestId: req.header("x-request-id"),
    ip: req.ip,
    apiKeyId: (req as AuthRequest).apiKeyId
  });
};

const resolveProjectSlug = (body: unknown): string | null => {
  if (!body || typeof body !== "object") return null;
  const projectSlug = (body as { projectSlug?: unknown }).projectSlug;
  return typeof projectSlug === "string" && projectSlug.trim() ? projectSlug.trim() : null;
};

export const requireIngestReplayProtection = (route: IngestRoute) => {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!isIngestSigningRequired()) {
      next();
      return;
    }

    const ingestReq = req as IngestRequest;
    const timestamp = req.header(TIMESTAMP_HEADER)?.trim();
    const nonce = req.header(NONCE_HEADER)?.trim();
    const signature = req.header(SIGNATURE_HEADER)?.trim();

    if (!timestamp || !nonce || !signature) {
      auditIngestRejection(route, "headers_missing", req);
      res.status(401).json({
        error: "Missing ingest signing headers",
        code: INGEST_ERROR_CODES.AUTH_INVALID
      });
      return;
    }

    const projectSlug = resolveProjectSlug(req.body);
    if (!projectSlug) {
      auditIngestRejection(route, "project_missing", req);
      res.status(401).json({
        error: "Missing projectSlug for ingest signing",
        code: INGEST_ERROR_CODES.AUTH_INVALID
      });
      return;
    }

    const project = await prisma.project.findFirst({
      where: {
        slug: projectSlug,
        ...(req.apiKeyOrganizationId ? { organizationId: req.apiKeyOrganizationId } : {}),
        ...(req.apiKeyProjectId ? { id: req.apiKeyProjectId } : {})
      },
      select: { id: true, signingSecret: true }
    });

    const signingSecret = project?.signingSecret?.trim();
    if (!project || !signingSecret) {
      auditIngestRejection(route, "signing_unconfigured", req);
      res.status(503).json({
        error: "Ingest signing is not configured",
        code: INGEST_ERROR_CODES.SIGNING_UNAVAILABLE
      });
      return;
    }

    if (!ingestReq.rawBody || ingestReq.rawBody.length === 0) {
      auditIngestRejection(route, "body_missing", req);
      res.status(401).json({
        error: "Missing request body",
        code: INGEST_ERROR_CODES.AUTH_INVALID
      });
      return;
    }

    const timestampMs = parseIngestTimestampMs(timestamp);
    if (timestampMs == null) {
      auditIngestRejection(route, "timestamp_invalid", req);
      res.status(401).json({
        error: "Invalid ingest timestamp",
        code: INGEST_ERROR_CODES.AUTH_INVALID
      });
      return;
    }

    if (Math.abs(Date.now() - timestampMs) > ingestTimestampWindowMs()) {
      auditIngestRejection(route, "timestamp_stale", req);
      res.status(401).json({
        error: "Request timestamp is outside the acceptance window",
        code: INGEST_ERROR_CODES.STALE
      });
      return;
    }

    if (!verifyIngestSignature(signingSecret, ingestReq.rawBody, { timestamp, nonce, signature })) {
      auditIngestRejection(route, "signature_invalid", req);
      res.status(401).json({
        error: "Invalid ingest signature",
        code: INGEST_ERROR_CODES.AUTH_INVALID
      });
      return;
    }

    const replayResult = await acceptIngestNonce({
      nonce,
      route,
      projectId: project.id,
      apiKeyId: req.apiKeyId
    });

    if (replayResult === "replay") {
      auditIngestRejection(route, "replay_detected", req);
      res.status(409).json({
        error: "Replayed ingest request",
        code: INGEST_ERROR_CODES.REPLAY
      });
      return;
    }

    next();
  };
};
