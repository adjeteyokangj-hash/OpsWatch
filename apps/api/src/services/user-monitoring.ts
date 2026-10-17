import { createHash } from "crypto";
import { classifySyncLane, type SyncLaneStatus } from "./device-heartbeat";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const USER_OFFLINE_AFTER_SECONDS = 10 * 60;

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  receptionist: "Receptionist",
  worker: "Receptionist"
};

export type StaffAccountStatus = "ACTIVE" | "SUSPENDED";
export type PropertyAccessMode = "ALL" | "ASSIGNED";
export type UserPresence = "ONLINE" | "OFFLINE" | "NEVER_CONNECTED" | "SUSPENDED";

export type DirectoryStaffRow = {
  userId: string;
  displayName: string | null;
  role: string | null;
  status: string | null;
  propertyIds?: string[] | null;
};

export type SanitizedStaff = {
  userId: string;
  displayName: string;
  role: string;
  accountStatus: StaffAccountStatus;
  propertyAccess: PropertyAccessMode;
  propertyIds: string[];
};

export type ParsedUserSession = {
  sessionId: string;
  installationId: string;
  claimedUserId: string | null;
  ticket: string;
  ended: boolean;
  lifecycleSync: SyncLaneStatus;
  financialSync: SyncLaneStatus;
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  oldestPendingAgeSeconds: number | null;
  lastSuccessfulSyncAt: string | null;
  sanitizedPayload: Record<string, unknown>;
};

export type SessionParseResult =
  | { kind: "absent" }
  | { kind: "invalid"; reason: string }
  | { kind: "session"; value: ParsedUserSession };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const text = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const uuid = (value: unknown): string | null => {
  const raw = text(value);
  return raw && UUID_PATTERN.test(raw) ? raw.toLowerCase() : null;
};

/** A display name that contains an email address is replaced with a neutral label. */
export const safeStaffLabel = (value: string | null | undefined): string => {
  const raw = value?.trim() ?? "";
  if (!raw || raw.includes("@") || /\d{8,}/.test(raw)) return "Staff";
  return raw.slice(0, 80);
};

export const roleLabel = (role: string | null | undefined): string =>
  ROLE_LABELS[role?.trim().toLowerCase() ?? ""] ?? "Staff";

const propertyIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => uuid(item)).filter((item): item is string => Boolean(item)))].sort();
};

/**
 * Accept only the fields a monitoring directory is allowed to store.
 * Email addresses are dropped even when a source row includes them.
 */
export const sanitizeDirectoryRow = (row: unknown): SanitizedStaff | null => {
  const record = asRecord(row);
  if (!record) return null;
  const userId = uuid(record.userId ?? record.user_id);
  const role = text(record.role)?.toLowerCase() ?? "";
  if (!userId || !ROLE_LABELS[role]) return null;
  const status = text(record.status)?.toLowerCase();
  const unrestricted = role === "owner" || role === "admin";
  return {
    userId,
    displayName: safeStaffLabel(text(record.displayName ?? record.display_name)),
    role: roleLabel(role),
    accountStatus: status === "disabled" || status === "suspended" ? "SUSPENDED" : "ACTIVE",
    propertyAccess: unrestricted ? "ALL" : "ASSIGNED",
    propertyIds: unrestricted ? [] : propertyIds(record.propertyIds ?? record.property_ids)
  };
};

export const sanitizeDirectory = (rows: unknown): SanitizedStaff[] => {
  if (!Array.isArray(rows)) return [];
  const byUser = new Map<string, SanitizedStaff>();
  for (const row of rows) {
    const staff = sanitizeDirectoryRow(row);
    if (staff) byUser.set(staff.userId, staff);
  }
  return [...byUser.values()];
};

const lane = (sync: Record<string, unknown> | null, key: string): SyncLaneStatus => {
  const value = asRecord(sync?.[key]);
  if (!value) return classifySyncLane(null);
  const pending = countOf(sync, key, "pending");
  const failed = countOf(sync, key, "failed");
  const age = value.oldestPendingAgeSeconds;
  return classifySyncLane({
    pending,
    failed,
    oldestPendingAgeSeconds: typeof age === "number" && Number.isFinite(age) && age >= 0 ? age : null
  });
};

const countOf = (sync: Record<string, unknown> | null, key: string, field: "pending" | "failed" | "conflicts"): number => {
  const value = asRecord(sync?.[key]);
  const count = value?.[field];
  return typeof count === "number" && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

/**
 * A monitoring ticket is an opaque identifier. Access tokens contain dots and are refused.
 */
/** SHA-256 hex of the ticket. The database stores this hash, not the ticket. */
export const hashMonitoringTicket = (ticket: string): string =>
  createHash("sha256").update(ticket.trim().toLowerCase(), "utf8").digest("hex");

export const monitoringTicket = (value: unknown): string | null => {
  const raw = text(value);
  if (!raw || raw.length < 32 || raw.length > 80 || raw.includes(".") || raw.includes("@")) return null;
  return raw;
};

export const parseSessionHeartbeat = (payload: unknown): SessionParseResult => {
  const root = asRecord(payload);
  if (!root || !("session" in root)) return { kind: "absent" };
  const session = asRecord(root.session);
  if (!session) return { kind: "invalid", reason: "Session monitoring requires a session object" };
  const sessionId = uuid(session.id);
  const installationId = uuid(session.installationId);
  const ticket = monitoringTicket(session.ticket);
  if (!sessionId || !installationId || !ticket) {
    return { kind: "invalid", reason: "Session monitoring requires a session, installation, and opaque ticket" };
  }
  const claimed = session.userId ?? session.user_id;
  const claimedUserId = claimed == null || claimed === "" ? null : uuid(claimed);
  if ((session.userId != null || session.user_id != null) && !claimedUserId) {
    return { kind: "invalid", reason: "The reported user identifier is not valid" };
  }
  const sync = asRecord(root.sync);
  const lifecycleSync = lane(sync, "lifecycle");
  const financialSync = lane(sync, "financial");
  const pendingCount = countOf(sync, "lifecycle", "pending") + countOf(sync, "financial", "pending");
  const failedCount = countOf(sync, "lifecycle", "failed") + countOf(sync, "financial", "failed");
  const conflictCount = countOf(sync, "lifecycle", "conflicts") + countOf(sync, "financial", "conflicts");
  const ages = ["lifecycle", "financial"]
    .map((key) => asRecord(sync?.[key])?.oldestPendingAgeSeconds)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0);
  return {
    kind: "session",
    value: {
      sessionId,
      installationId,
      claimedUserId,
      ticket,
      ended: session.ended === true,
      lifecycleSync,
      financialSync,
      pendingCount,
      failedCount,
      conflictCount,
      oldestPendingAgeSeconds: ages.length > 0 ? Math.max(...ages) : null,
      lastSuccessfulSyncAt: text(sync?.lastSuccessfulSyncAt),
      sanitizedPayload: {
        session: { id: sessionId, installationId },
        sync: {
          lifecycle: lifecycleSync,
          financial: financialSync,
          pending: pendingCount,
          failed: failedCount,
          conflicts: conflictCount
        }
      }
    }
  };
};

export type IdentityBinding =
  | { ok: true; userId: string }
  | { ok: false; reason: string };

/**
 * The stored user is the user proven by the ticket. A different identifier in the payload is rejected.
 */
export const bindMonitoringUser = (claimedUserId: string | null, verifiedUserId: string | null): IdentityBinding => {
  if (!verifiedUserId || !UUID_PATTERN.test(verifiedUserId)) {
    return { ok: false, reason: "The monitoring identity was not verified" };
  }
  if (claimedUserId && claimedUserId !== verifiedUserId.toLowerCase()) {
    return { ok: false, reason: "The reported user does not match the authenticated NiiNai session" };
  }
  return { ok: true, userId: verifiedUserId.toLowerCase() };
};

export type PresentedSession = {
  sessionId: string;
  installationId: string;
  appVersion: string | null;
  presence: "ONLINE" | "OFFLINE" | "ENDED";
  lifecycleSync: string;
  financialSync: string;
  lastSeenAt: string;
};

export type PresentedUser = {
  userId: string;
  displayName: string;
  role: string;
  propertyAccess: "All properties" | "Assigned properties";
  status: UserPresence;
  statusLabel: string;
  sessions: number;
  sessionDetails: PresentedSession[];
};

type StaffSource = SanitizedStaff & { directorySeenAt?: Date | string | null };
type SessionSource = {
  sessionId: string;
  userId: string;
  installationId: string;
  appVersion?: string | null;
  lifecycleSync?: string | null;
  financialSync?: string | null;
  lastSeenAt: Date | string;
  endedAt?: Date | string | null;
  offlineAfterSeconds?: number | null;
};

const sessionPresence = (row: SessionSource, now: Date): PresentedSession["presence"] => {
  if (row.endedAt) return "ENDED";
  const seen = new Date(row.lastSeenAt).getTime();
  const limit = (row.offlineAfterSeconds && row.offlineAfterSeconds > 0 ? row.offlineAfterSeconds : USER_OFFLINE_AFTER_SECONDS) * 1000;
  return now.getTime() - seen >= limit ? "OFFLINE" : "ONLINE";
};

export const presentMonitoredUsers = (
  staff: StaffSource[],
  sessions: SessionSource[],
  now = new Date()
): PresentedUser[] => {
  const known = new Set(staff.map((row) => row.userId));
  const grouped = new Map<string, PresentedSession[]>();
  for (const row of sessions) {
    if (!known.has(row.userId)) continue;
    const presence = sessionPresence(row, now);
    const detail: PresentedSession = {
      sessionId: row.sessionId,
      installationId: row.installationId,
      appVersion: row.appVersion ?? null,
      presence,
      lifecycleSync: row.lifecycleSync ?? "UNKNOWN",
      financialSync: row.financialSync ?? "UNKNOWN",
      lastSeenAt: new Date(row.lastSeenAt).toISOString()
    };
    grouped.set(row.userId, [...(grouped.get(row.userId) ?? []), detail]);
  }

  return staff
    .map((row) => {
      const details = (grouped.get(row.userId) ?? []).sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
      const online = details.filter((item) => item.presence === "ONLINE").length;
      let status: UserPresence = "NEVER_CONNECTED";
      let statusLabel = "Never connected";
      if (row.accountStatus === "SUSPENDED") {
        status = "SUSPENDED";
        statusLabel = "Suspended";
      } else if (online > 0) {
        status = "ONLINE";
        statusLabel = "Online";
      } else if (details.length > 0) {
        status = "OFFLINE";
        statusLabel = "Offline";
      }
      return {
        userId: row.userId,
        displayName: row.displayName,
        role: row.role,
        propertyAccess: row.propertyAccess === "ALL" ? "All properties" as const : "Assigned properties" as const,
        status,
        statusLabel,
        sessions: row.accountStatus === "SUSPENDED" ? 0 : online,
        sessionDetails: details.filter((item) => item.presence !== "ENDED")
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
};

export type MonitoringDirectoryFetcher = () => Promise<unknown>;

let directoryFetcher: MonitoringDirectoryFetcher | null = null;
let ticketVerifier: ((ticket: string) => Promise<string | null>) | null = null;

export const setMonitoringDirectoryFetcher = (fetcher: MonitoringDirectoryFetcher | null): void => {
  directoryFetcher = fetcher;
};

export const setMonitoringTicketVerifier = (verifier: ((ticket: string) => Promise<string | null>) | null): void => {
  ticketVerifier = verifier;
};

export const verifyMonitoringTicket = async (ticket: string): Promise<string | null> => {
  if (!ticketVerifier) return null;
  const userId = await ticketVerifier(ticket);
  return uuid(userId);
};

export const pullStaffDirectory = async (): Promise<SanitizedStaff[] | null> => {
  if (!directoryFetcher) return null;
  return sanitizeDirectory(await directoryFetcher());
};
