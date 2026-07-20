import { ingestSecurityEvents, type SecurityEventIngestInput } from "./security-ingest.service";

/**
 * Bridge for OpsWatch-internal platform signals into the security event store.
 * Callers must not pass passwords, tokens, cookies, or full credentials.
 */
export const recordInternalSecurityEvent = async (
  organizationId: string,
  event: SecurityEventIngestInput,
  source = "opswatch_internal"
) => {
  const result = await ingestSecurityEvents([event], {
    organizationId,
    providerSource: source,
    rawSource: source,
    privacy: { truncateIp: true, hashAccounts: true }
  });
  return result;
};

export const recordInternalSecurityEvents = async (
  organizationId: string,
  events: SecurityEventIngestInput[],
  source = "opswatch_internal"
) =>
  ingestSecurityEvents(events, {
    organizationId,
    providerSource: source,
    rawSource: source,
    privacy: { truncateIp: true, hashAccounts: true }
  });
