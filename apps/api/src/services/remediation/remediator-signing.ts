import { createHash, randomUUID } from "crypto";
import { hmacDigest, timingSafeEqualString } from "../../lib/request-signature";

export const REMEDIATOR_REQUEST_MAX_AGE_MS = Number(
  process.env.REMEDIATOR_REQUEST_MAX_AGE_MS || 5 * 60_000
);

export type RemediatorSignedFields = {
  timestamp: string;
  nonce: string;
  projectId: string;
  incidentId?: string | null;
  action: string;
  target?: string | null;
  reason?: string | null;
  idempotencyKey: string;
};

/** Canonical string for outbound remediator HMAC signatures. */
export const buildRemediatorSignedContent = (fields: RemediatorSignedFields): string =>
  [
    fields.timestamp,
    fields.nonce,
    fields.projectId,
    fields.incidentId ?? "",
    fields.action,
    fields.target ?? "",
    fields.reason ?? "",
    fields.idempotencyKey
  ].join(".");

export const computeRemediatorSignature = (
  secret: string,
  fields: RemediatorSignedFields
): string => hmacDigest(secret, buildRemediatorSignedContent(fields), "sha256", "hex");

export const verifyRemediatorSignature = (
  secret: string,
  fields: RemediatorSignedFields,
  signature: string
): boolean => {
  const expected = computeRemediatorSignature(secret, fields);
  return timingSafeEqualString(signature, expected);
};

export const isRemediatorTimestampFresh = (
  timestamp: string,
  nowMs = Date.now(),
  maxAgeMs = REMEDIATOR_REQUEST_MAX_AGE_MS
): boolean => {
  const trimmed = timestamp.trim();
  let tsMs: number | null = null;
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) {
      tsMs = trimmed.length <= 10 ? numeric * 1000 : numeric;
    }
  } else {
    const parsed = Date.parse(trimmed);
    if (Number.isFinite(parsed)) tsMs = parsed;
  }
  if (tsMs === null) return false;
  return Math.abs(nowMs - tsMs) <= maxAgeMs;
};

export const newRemediatorNonce = (): string => randomUUID();

export const newIdempotencyKey = (parts: string[]): string => {
  const raw = parts.filter(Boolean).join(":");
  return createHash("sha256").update(raw).digest("hex").slice(0, 48);
};

export const remediatorSigningHeaders = (
  secret: string,
  fields: RemediatorSignedFields
): Record<string, string> => ({
  "Content-Type": "application/json",
  "X-OpsWatch-Remediator-Timestamp": fields.timestamp,
  "X-OpsWatch-Remediator-Nonce": fields.nonce,
  "X-OpsWatch-Remediator-Signature": computeRemediatorSignature(secret, fields),
  "X-OpsWatch-Remediator-Idempotency-Key": fields.idempotencyKey
});
