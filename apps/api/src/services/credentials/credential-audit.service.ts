import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { redactUnknown } from "../../lib/redact-secrets";

const SECRET_METADATA_PATTERN =
  /(secret|password|token|ciphertext|authTag|signingSecret|apiKey|authSecret|REMEDIATOR_WEBHOOK_SECRET|plaintext|iv|fingerprint)/i;

export type CredentialAuditAction =
  | "CREDENTIAL_CREATED"
  | "CREDENTIAL_REPLACED"
  | "CREDENTIAL_ROTATED"
  | "CREDENTIAL_REVOKED"
  | "CREDENTIAL_EXPIRY_CHANGED"
  | "CONNECTION_TESTED"
  | "AUTH_FAILED"
  | "CREDENTIAL_USED"
  | "SECRET_REFERENCE_CHANGED";

export type RecordCredentialAuditInput = {
  organizationId: string;
  userId?: string | null;
  action: CredentialAuditAction | string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown> | null;
};

const sanitizeMetadata = (metadata: Record<string, unknown> | null | undefined): Record<string, unknown> => {
  const redacted = redactUnknown(metadata ?? {}) as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(redacted)) {
    if (SECRET_METADATA_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = value;
  }
  return output;
};

export const recordCredentialAudit = async (input: RecordCredentialAuditInput): Promise<void> => {
  const metadata = sanitizeMetadata(input.metadata ?? undefined);
  await prisma.auditLog.create({
    data: {
      id: randomUUID(),
      userId: input.userId ?? null,
      organizationId: input.organizationId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadataJson: (Object.keys(metadata).length > 0 ? metadata : undefined) as
        | Prisma.InputJsonValue
        | undefined
    }
  });
};
