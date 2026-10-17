/**
 * Desktop computer heartbeats.
 *
 * A payload with `device.id` belongs to one computer. It must not change the
 * parent project status. Stored fields are an allow-list: guest, payment, and
 * credential fields are dropped before anything is written.
 *
 * Expected client shape (NiiNai step 2):
 * {
 *   device: { id, label?, reportedName? },
 *   propertyId?,
 *   sync: {
 *     lastSuccessfulSyncAt?,
 *     pendingCount?, failedCount?, conflictCount?, oldestPendingAgeSeconds?,
 *     lifecycle?: { pending, failed, oldestPendingAgeSeconds },
 *     financial?: { pending, failed, oldestPendingAgeSeconds }
 *   }
 * }
 */

export const DEVICE_HEARTBEAT_INTERVAL_SECONDS = 90;
export const DEVICE_OFFLINE_AFTER_SECONDS = 10 * 60;
export const DEVICE_SYNC_DELAY_AFTER_SECONDS = 15 * 60;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type SyncLaneStatus = "HEALTHY" | "DELAYED" | "FAILED" | "UNKNOWN";
export type DevicePresence = "ONLINE" | "OFFLINE";

export type SanitizedSyncLane = {
  pending: number;
  failed: number;
  oldestPendingAgeSeconds: number | null;
};

export type SanitizedDeviceHeartbeat = {
  deviceId: string;
  suggestedLabel: string | null;
  reportedName: string | null;
  propertyId: string | null;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  oldestPendingAgeSeconds: number | null;
  lastSuccessfulSyncAt: string | null;
  lifecycle: SanitizedSyncLane | null;
  financial: SanitizedSyncLane | null;
  lifecycleSync: SyncLaneStatus;
  financialSync: SyncLaneStatus;
  payload: Record<string, unknown>;
};

export type DeviceHeartbeatParse =
  | { kind: "absent" }
  | { kind: "invalid" }
  | { kind: "device"; value: SanitizedDeviceHeartbeat };

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const boundedText = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  if (!trimmed) return null;
  if (trimmed.includes("@")) return null;
  if (/[0-9]{8,}/.test(trimmed)) return null;
  return trimmed;
};

const count = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), 1_000_000);
};

const ageSeconds = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.floor(value), 86_400 * 30);
};

const isoTimestamp = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim().length > 40) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const syncLane = (value: unknown): SanitizedSyncLane | null => {
  const row = asRecord(value);
  if (!row) return null;
  return {
    pending: count(row.pending),
    failed: count(row.failed),
    oldestPendingAgeSeconds: ageSeconds(row.oldestPendingAgeSeconds)
  };
};

export const classifySyncLane = (
  lane: SanitizedSyncLane | null
): SyncLaneStatus => {
  if (!lane) return "UNKNOWN";
  if (lane.failed > 0) return "FAILED";
  if (
    lane.pending > 0 &&
    (lane.oldestPendingAgeSeconds ?? 0) >= DEVICE_SYNC_DELAY_AFTER_SECONDS
  ) {
    return "DELAYED";
  }
  return "HEALTHY";
};

export const devicePresence = (
  lastSeenAt: Date,
  offlineAfterSeconds: number,
  now: Date = new Date()
): DevicePresence => {
  const limitSeconds = offlineAfterSeconds > 0 ? offlineAfterSeconds : DEVICE_OFFLINE_AFTER_SECONDS;
  return now.getTime() - lastSeenAt.getTime() >= limitSeconds * 1000 ? "OFFLINE" : "ONLINE";
};

export const sanitizeAppVersion = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^[0-9A-Za-z._+-]{1,32}$/.test(trimmed)) return null;
  return trimmed;
};

export const sanitizeDeviceMessage = (value: unknown): string | null => boundedText(value, 200);

export const NIINAI_DEVICE_CREDENTIAL_PREFIX = "NiiNai computer ";

/** A per-computer ingest key may update only the computer it was enrolled for. */
export const deviceCredentialRejection = (
  apiKeyName: string | null | undefined,
  payload: unknown
): string | null => {
  const name = apiKeyName?.trim() ?? "";
  if (!name.startsWith(NIINAI_DEVICE_CREDENTIAL_PREFIX)) return null;
  const boundId = name.slice(NIINAI_DEVICE_CREDENTIAL_PREFIX.length).trim();
  if (!UUID_PATTERN.test(boundId)) return "Device credential is not bound to a computer";
  const parsed = parseDeviceHeartbeatPayload(payload);
  if (parsed.kind !== "device" || parsed.value.deviceId.toLowerCase() !== boundId.toLowerCase()) {
    return "Device credential does not match this computer";
  }
  return null;
};

export const parseDeviceHeartbeatPayload = (payload: unknown): DeviceHeartbeatParse => {
  const root = asRecord(payload);
  if (!root || !Object.prototype.hasOwnProperty.call(root, "device")) {
    return { kind: "absent" };
  }
  const device = asRecord(root.device);
  const deviceId = typeof device?.id === "string" ? device.id.trim() : "";
  if (!UUID_PATTERN.test(deviceId)) return { kind: "invalid" };

  const sync = asRecord(root.sync);
  const lifecycle = syncLane(sync?.lifecycle);
  const financial = syncLane(sync?.financial);
  const propertyId =
    typeof root.propertyId === "string" && UUID_PATTERN.test(root.propertyId.trim())
      ? root.propertyId.trim()
      : null;
  const suggestedLabel = boundedText(device?.label, 80);
  const reportedName = boundedText(device?.reportedName, 80) ?? suggestedLabel;
  const pendingCount = count(sync?.pendingCount);
  const failedCount = count(sync?.failedCount);
  const conflictCount = count(sync?.conflictCount);
  const oldestPendingAgeSeconds = ageSeconds(sync?.oldestPendingAgeSeconds);
  const lastSuccessfulSyncAt = isoTimestamp(sync?.lastSuccessfulSyncAt);

  const sanitized: Record<string, unknown> = {
    device: {
      id: deviceId,
      ...(suggestedLabel ? { label: suggestedLabel } : {}),
      ...(reportedName ? { reportedName } : {})
    },
    ...(propertyId ? { propertyId } : {}),
    sync: {
      pendingCount,
      failedCount,
      conflictCount,
      oldestPendingAgeSeconds,
      lastSuccessfulSyncAt,
      lifecycle,
      financial
    }
  };

  return {
    kind: "device",
    value: {
      deviceId,
      suggestedLabel,
      reportedName,
      propertyId,
      pendingCount,
      failedCount,
      conflictCount,
      oldestPendingAgeSeconds,
      lastSuccessfulSyncAt,
      lifecycle,
      financial,
      lifecycleSync: classifySyncLane(lifecycle),
      financialSync: classifySyncLane(financial),
      payload: sanitized
    }
  };
};

export type MonitoredDeviceRow = {
  id: string;
  deviceId: string;
  label?: string | null;
  reportedName?: string | null;
  propertyId?: string | null;
  appVersion?: string | null;
  reportedStatus?: string | null;
  message?: string | null;
  lifecycleSync?: string | null;
  financialSync?: string | null;
  pendingCount?: number | null;
  failedCount?: number | null;
  lastSuccessfulSyncAt?: Date | string | null;
  lastSeenAt: Date | string;
  offlineAfterSeconds?: number | null;
};

export type PresentedDevice = {
  id: string;
  deviceId: string;
  displayName: string;
  propertyId: string | null;
  presence: DevicePresence;
  reportedStatus: string;
  appVersion: string | null;
  versionNote: string | null;
  lifecycleSync: SyncLaneStatus;
  financialSync: SyncLaneStatus;
  pendingCount: number;
  failedCount: number;
  lastSeenAt: string;
  lastSuccessfulSyncAt: string | null;
  message: string | null;
};

const syncStatus = (value: string | null | undefined): SyncLaneStatus => {
  if (value === "HEALTHY" || value === "DELAYED" || value === "FAILED") return value;
  return "UNKNOWN";
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

export const presentMonitoredDevices = (
  rows: readonly MonitoredDeviceRow[],
  now: Date = new Date()
): PresentedDevice[] => {
  const versions = new Set(
    rows
      .map((row) => row.appVersion?.trim() || "")
      .filter((version) => version.length > 0)
  );
  const versionsDiffer = versions.size > 1;

  return rows.map((row) => {
    const lastSeen = row.lastSeenAt instanceof Date ? row.lastSeenAt : new Date(row.lastSeenAt);
    const version = row.appVersion?.trim() || null;
    return {
      id: row.id,
      deviceId: row.deviceId,
      displayName: row.label?.trim() || row.reportedName?.trim() || `Computer ${row.deviceId.slice(0, 8)}`,
      propertyId: row.propertyId ?? null,
      presence: devicePresence(lastSeen, row.offlineAfterSeconds ?? DEVICE_OFFLINE_AFTER_SECONDS, now),
      reportedStatus: row.reportedStatus ?? "UNKNOWN",
      appVersion: version,
      versionNote: versionsDiffer && version ? "Different from another computer" : null,
      lifecycleSync: syncStatus(row.lifecycleSync),
      financialSync: syncStatus(row.financialSync),
      pendingCount: row.pendingCount ?? 0,
      failedCount: row.failedCount ?? 0,
      lastSeenAt: lastSeen.toISOString(),
      lastSuccessfulSyncAt: toIso(row.lastSuccessfulSyncAt),
      message: row.message ?? null
    };
  });
};
