import { createHash, randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { isSecurityEventType, eventFamily } from "./security-event-types";
import {
  applyPrivacyToIdentifiers,
  redactSecurityPayload
} from "./security-redaction";
import {
  DEFAULT_SECURITY_RETENTION_DAYS,
  MAX_SECURITY_EVENT_PAYLOAD_BYTES,
  MAX_SECURITY_EVENTS_PER_BATCH,
  SECURITY_TIMESTAMP_MAX_AGE_MS,
  SECURITY_TIMESTAMP_SKEW_MS
} from "./security-scopes";

export type SecurityEventIngestInput = {
  eventType: string;
  severity?: string;
  timestamp?: string | Date;
  environment?: string;
  projectId?: string | null;
  locationId?: string | null;
  entityId?: string | null;
  relationshipId?: string | null;
  accountIdentifier?: string | null;
  sourceIp?: string | null;
  geography?: string | null;
  deviceSessionId?: string | null;
  connectionId?: string | null;
  providerSource?: string | null;
  correlationId?: string | null;
  traceId?: string | null;
  evidenceRef?: string | null;
  idempotencyKey?: string | null;
  payload?: unknown;
  metadata?: unknown;
  rawSource?: string | null;
};

export type SecurityIngestItemResult =
  | { index: number; status: "accepted"; id: string; duplicate?: boolean }
  | { index: number; status: "rejected"; error: string };

export type SecurityIngestBatchResult = {
  accepted: number;
  rejected: number;
  duplicates: number;
  results: SecurityIngestItemResult[];
};

const VALID_SEVERITIES = new Set(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const bytesOf = (value: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

const resolveRetentionDays = async (organizationId: string): Promise<number> => {
  const policy = await prisma.retentionPolicy.findUnique({
    where: {
      organizationId_dataClass: {
        organizationId,
        dataClass: "SECURITY_EVENTS"
      }
    }
  });
  if (policy?.retentionDays && policy.retentionDays > 0) return policy.retentionDays;
  return DEFAULT_SECURITY_RETENTION_DAYS;
};

const parseTimestamp = (value: string | Date | undefined, now: Date): Date | null => {
  if (value === undefined) return now;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export const validateSecurityEventTimestamp = (
  timestamp: Date,
  now = new Date()
): string | null => {
  if (timestamp.getTime() > now.getTime() + SECURITY_TIMESTAMP_SKEW_MS) {
    return "timestamp too far in the future";
  }
  if (timestamp.getTime() < now.getTime() - SECURITY_TIMESTAMP_MAX_AGE_MS) {
    return "timestamp too old";
  }
  return null;
};

export type IngestSecurityEventsOptions = {
  organizationId: string;
  environmentBinding?: string | null;
  connectionId?: string | null;
  providerSource?: string | null;
  rawSource?: string | null;
  allowedEventFamilies?: string[] | null;
  privacy?: { truncateIp?: boolean; hashAccounts?: boolean };
};

export const ingestSecurityEvents = async (
  events: SecurityEventIngestInput[],
  options: IngestSecurityEventsOptions
): Promise<SecurityIngestBatchResult> => {
  const results: SecurityIngestItemResult[] = [];
  let accepted = 0;
  let rejected = 0;
  let duplicates = 0;
  const now = new Date();

  if (!Array.isArray(events) || events.length === 0) {
    return { accepted: 0, rejected: 0, duplicates: 0, results: [] };
  }
  if (events.length > MAX_SECURITY_EVENTS_PER_BATCH) {
    return {
      accepted: 0,
      rejected: events.length,
      duplicates: 0,
      results: events.map((_, index) => ({
        index,
        status: "rejected",
        error: `batch exceeds limit of ${MAX_SECURITY_EVENTS_PER_BATCH}`
      }))
    };
  }

  const retentionDays = await resolveRetentionDays(options.organizationId);
  const retentionExpiresAt = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

  for (let index = 0; index < events.length; index += 1) {
    const item = events[index];
    try {
      if (!item || typeof item !== "object") {
        rejected += 1;
        results.push({ index, status: "rejected", error: "invalid event object" });
        continue;
      }
      if (!item.eventType || !isSecurityEventType(item.eventType)) {
        rejected += 1;
        results.push({ index, status: "rejected", error: "unsupported or missing eventType" });
        continue;
      }
      const family = eventFamily(item.eventType);
      if (
        options.allowedEventFamilies &&
        options.allowedEventFamilies.length > 0 &&
        !options.allowedEventFamilies.includes(family) &&
        !options.allowedEventFamilies.includes("security")
      ) {
        rejected += 1;
        results.push({
          index,
          status: "rejected",
          error: `scope does not allow event family ${family}`
        });
        continue;
      }

      const environment = (item.environment || options.environmentBinding || "unknown").trim();
      if (
        options.environmentBinding &&
        item.environment &&
        item.environment !== options.environmentBinding
      ) {
        rejected += 1;
        results.push({ index, status: "rejected", error: "environment binding mismatch" });
        continue;
      }

      const timestamp = parseTimestamp(item.timestamp, now);
      if (!timestamp) {
        rejected += 1;
        results.push({ index, status: "rejected", error: "invalid timestamp" });
        continue;
      }
      const tsError = validateSecurityEventTimestamp(timestamp, now);
      if (tsError) {
        rejected += 1;
        results.push({ index, status: "rejected", error: tsError });
        continue;
      }

      if (bytesOf(item.payload) > MAX_SECURITY_EVENT_PAYLOAD_BYTES) {
        rejected += 1;
        results.push({ index, status: "rejected", error: "payload too large" });
        continue;
      }

      const severity = (item.severity || "MEDIUM").toUpperCase();
      if (!VALID_SEVERITIES.has(severity)) {
        rejected += 1;
        results.push({ index, status: "rejected", error: "invalid severity" });
        continue;
      }

      const { value: payloadJson, meta: redactionMeta } = redactSecurityPayload(item.payload ?? null);
      const { value: metadataJson } = redactSecurityPayload(item.metadata ?? null);
      const privacy = applyPrivacyToIdentifiers(
        options.organizationId,
        {
          accountIdentifier: item.accountIdentifier,
          sourceIp: item.sourceIp,
          deviceSessionId: item.deviceSessionId
        },
        options.privacy
      );

      const idempotencyKey =
        item.idempotencyKey?.trim() ||
        createHash("sha256")
          .update(
            [
              options.organizationId,
              item.eventType,
              timestamp.toISOString(),
              environment,
              item.accountIdentifier || "",
              item.correlationId || "",
              JSON.stringify(payloadJson ?? {})
            ].join("|")
          )
          .digest("hex")
          .slice(0, 48);

      const existing = await prisma.securityEvent.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: options.organizationId,
            idempotencyKey
          }
        },
        select: { id: true }
      });
      if (existing) {
        accepted += 1;
        duplicates += 1;
        results.push({ index, status: "accepted", id: existing.id, duplicate: true });
        continue;
      }

      const id = randomUUID();
      await prisma.securityEvent.create({
        data: {
          id,
          organizationId: options.organizationId,
          projectId: item.projectId || null,
          environment,
          locationId: item.locationId || null,
          entityId: item.entityId || null,
          relationshipId: item.relationshipId || null,
          accountIdentifierHash: privacy.accountIdentifierHash,
          sourceIpTruncated: privacy.sourceIpTruncated,
          geography: item.geography ? String(item.geography).slice(0, 128) : null,
          deviceSessionHash: privacy.deviceSessionHash,
          eventType: item.eventType,
          severity,
          timestamp,
          receivedAt: now,
          connectionId: item.connectionId || options.connectionId || null,
          providerSource: item.providerSource || options.providerSource || null,
          correlationId: item.correlationId || null,
          traceId: item.traceId || null,
          evidenceRef: item.evidenceRef || null,
          redactionState:
            redactionMeta.fieldsRedacted.length > 0 || privacy.meta.accountHashed
              ? "REDACTED"
              : "CLEAN",
          retentionExpiresAt,
          idempotencyKey,
          payloadJson: payloadJson ?? undefined,
          rawSource: item.rawSource || options.rawSource || null,
          metadataJson: {
            ...(metadataJson && typeof metadataJson === "object" ? metadataJson : {}),
            redaction: {
              fieldsRedacted: redactionMeta.fieldsRedacted,
              truncated: redactionMeta.truncated,
              ipTruncated: privacy.meta.ipTruncated,
              accountHashed: privacy.meta.accountHashed
            }
          }
        }
      });

      accepted += 1;
      results.push({ index, status: "accepted", id });
    } catch (error) {
      rejected += 1;
      const message = error instanceof Error ? error.message : "persist failed";
      results.push({ index, status: "rejected", error: message.slice(0, 200) });
    }
  }

  return { accepted, rejected, duplicates, results };
};
