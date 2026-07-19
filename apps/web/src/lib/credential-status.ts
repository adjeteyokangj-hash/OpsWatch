/** Shared credential lifecycle labels and styling for API keys and connections. */

export type CredentialLifecycleStatus =
  | "ACTIVE"
  | "EXPIRING_SOON"
  | "EXPIRED"
  | "REVOKED"
  | "ROTATION_PENDING"
  | "CONNECTION_FAILED"
  | "NOT_CONFIGURED";

export type StatusPillVariant = "pass" | "warn" | "fail" | "neutral";

const STATUS_LABELS: Record<CredentialLifecycleStatus, string> = {
  ACTIVE: "Active",
  EXPIRING_SOON: "Expiring soon",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
  ROTATION_PENDING: "Rotation pending",
  CONNECTION_FAILED: "Connection failed",
  NOT_CONFIGURED: "Not configured"
};

const STATUS_PILL_CLASS: Record<CredentialLifecycleStatus, StatusPillVariant> = {
  ACTIVE: "pass",
  EXPIRING_SOON: "warn",
  EXPIRED: "warn",
  REVOKED: "fail",
  ROTATION_PENDING: "warn",
  CONNECTION_FAILED: "fail",
  NOT_CONFIGURED: "neutral"
};

export const normalizeCredentialStatus = (value: string | null | undefined): CredentialLifecycleStatus | null => {
  if (!value) return null;
  const upper = value.toUpperCase().replace(/[\s-]+/g, "_");
  if (upper in STATUS_LABELS) return upper as CredentialLifecycleStatus;
  return null;
};

export const credentialStatusLabel = (status: string): string => {
  const normalized = normalizeCredentialStatus(status);
  if (normalized) return STATUS_LABELS[normalized];
  return status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (char) => char.toUpperCase());
};

export const credentialStatusPillClass = (status: string): StatusPillVariant => {
  const normalized = normalizeCredentialStatus(status);
  if (normalized) return STATUS_PILL_CLASS[normalized];
  return "neutral";
};

export const formatCredentialDate = (value: string | null | undefined): string => {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleString();
};

export const formatCredentialDateOrNever = (value: string | null | undefined): string => {
  if (!value) return "Never";
  return formatCredentialDate(value);
};

export const maskedSecretConfiguredLabel = (configured: boolean): string =>
  configured ? "Configured" : "Not configured";

export type ConnectionCredentialInput = {
  isActive?: boolean;
  secretConfigured?: boolean;
  authMethod?: string;
  health?: string | null;
  installationStatus?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  credentialStatus?: string | null;
  credentialExpiresAt?: string | null;
};

export const deriveConnectionCredentialStatus = (
  connection: ConnectionCredentialInput
): CredentialLifecycleStatus => {
  const explicit = normalizeCredentialStatus(connection.credentialStatus ?? undefined);
  if (explicit && explicit !== "NOT_CONFIGURED") return explicit;

  if (connection.isActive === false) return "REVOKED";

  const authMethod = (connection.authMethod ?? "NONE").toUpperCase();
  if (authMethod !== "NONE" && !connection.secretConfigured) return "NOT_CONFIGURED";

  if (connection.credentialExpiresAt) {
    const expiresAt = new Date(connection.credentialExpiresAt).getTime();
    if (!Number.isNaN(expiresAt)) {
      const now = Date.now();
      if (expiresAt <= now) return "EXPIRED";
      const expiringSoonMs = 14 * 24 * 60 * 60 * 1000;
      if (expiresAt - now <= expiringSoonMs) return "EXPIRING_SOON";
    }
  }

  const health = String(connection.health ?? "").toUpperCase();
  const installation = String(connection.installationStatus ?? "").toUpperCase();
  if (health === "UNHEALTHY" || health === "FAILED" || installation === "FAILED") {
    return "CONNECTION_FAILED";
  }

  if (connection.lastFailureAt) {
    const failureAt = new Date(connection.lastFailureAt).getTime();
    const successAt = connection.lastSuccessAt ? new Date(connection.lastSuccessAt).getTime() : 0;
    if (!Number.isNaN(failureAt) && failureAt >= successAt) return "CONNECTION_FAILED";
  }

  return explicit ?? "ACTIVE";
};

export const canRotateApiKey = (status: string): boolean =>
  status === "ACTIVE" || status === "EXPIRING_SOON";

export const canRevokeApiKey = (status: string): boolean =>
  status === "ACTIVE" || status === "EXPIRING_SOON" || status === "ROTATION_PENDING";
