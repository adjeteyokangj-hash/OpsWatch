import type { IntegrationType } from "@prisma/client";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "../../lib/secret-crypto";
import { resolveConnectionSecretReference } from "../agentless-connection.service";
import {
  createCredentialVersion,
  resolveActiveSecrets,
  type CredentialMetadataDto
} from "../credentials/managed-credential.service";
import {
  DEFAULT_CAPABILITIES,
  isRemediatorProviderType,
  remediatorUrlKeyForProvider,
  type RemediatorAction,
  type RemediatorProviderType
} from "./remediator-actions";

export const REMEDIATOR_SECRET_CONFIG_KEY = "REMEDIATOR_WEBHOOK_SECRET";
export const REMEDIATOR_SECRET_ENC_KEY = "_remediatorSecretEnc";
export const REMEDIATOR_CAPABILITIES_KEY = "REMEDIATOR_CAPABILITIES";
export const REMEDIATOR_EMERGENCY_DISABLE_KEY = "REMEDIATOR_EMERGENCY_DISABLED";
export const REMEDIATOR_CIRCUIT_OPEN_UNTIL_KEY = "REMEDIATOR_CIRCUIT_OPEN_UNTIL";
export const REMEDIATOR_CIRCUIT_FAILURES_KEY = "REMEDIATOR_CIRCUIT_FAILURES";
/** Sentinel from UI / API when caller wants to keep the previously stored secret. */
export const SECRET_BLANK_PRESERVE = "";

export type RemediatorSecretEnc = EncryptedSecret;

export type RemediatorConfig = {
  webhookUrl: string | null;
  secretConfigured: boolean;
  credential?: CredentialMetadataDto | null;
  capabilities: RemediatorAction[];
  emergencyDisabled: boolean;
  circuitOpenUntil: Date | null;
  circuitFailures: number;
  timeoutMs: number;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const parseCapabilities = (raw: unknown): RemediatorAction[] => {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is RemediatorAction => typeof item === "string");
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is RemediatorAction => typeof item === "string");
      }
    } catch {
      return raw
        .split(",")
        .map((part) => part.trim())
        .filter((part): part is RemediatorAction => Boolean(part));
    }
  }
  return [];
};

export const readRemediatorConfig = (
  type: IntegrationType | string,
  configJson: Record<string, unknown> | null | undefined,
  secretRef?: string | null,
  credential?: CredentialMetadataDto | null
): RemediatorConfig => {
  const config = asRecord(configJson);
  const providerType = isRemediatorProviderType(String(type))
    ? (String(type) as RemediatorProviderType)
    : null;
  const urlKey = providerType ? remediatorUrlKeyForProvider(providerType) : null;
  const webhookUrl =
    (urlKey && typeof config[urlKey] === "string" && config[urlKey].trim()) ||
    (typeof config.REMEDIATOR_WEBHOOK_URL === "string" && config.REMEDIATOR_WEBHOOK_URL.trim()) ||
    null;

  const timeoutRaw =
    config.WORKER_PROVIDER_TIMEOUT_MS ??
    config.SERVICE_PROVIDER_TIMEOUT_MS ??
    config.DEPLOYMENT_PROVIDER_TIMEOUT_MS ??
    config.REMEDIATOR_TIMEOUT_MS ??
    10_000;
  const timeoutMs = Math.max(1_000, Number(timeoutRaw) || 10_000);

  const advertised = parseCapabilities(config[REMEDIATOR_CAPABILITIES_KEY]);
  const capabilities =
    advertised.length > 0
      ? advertised
      : providerType
        ? [...DEFAULT_CAPABILITIES[providerType]]
        : [];

  const circuitRaw = config[REMEDIATOR_CIRCUIT_OPEN_UNTIL_KEY];
  const circuitOpenUntil =
    typeof circuitRaw === "string" && circuitRaw.trim()
      ? new Date(circuitRaw)
      : null;

  const secretConfigured = Boolean(
    credential?.configured ||
      secretRef ||
      config[REMEDIATOR_SECRET_ENC_KEY] ||
      (typeof config[REMEDIATOR_SECRET_CONFIG_KEY] === "string" &&
        config[REMEDIATOR_SECRET_CONFIG_KEY].trim())
  );

  return {
    webhookUrl,
    secretConfigured,
    credential: credential ?? null,
    capabilities,
    emergencyDisabled:
      config[REMEDIATOR_EMERGENCY_DISABLE_KEY] === true ||
      config[REMEDIATOR_EMERGENCY_DISABLE_KEY] === "true",
    circuitOpenUntil:
      circuitOpenUntil && !Number.isNaN(circuitOpenUntil.getTime()) ? circuitOpenUntil : null,
    circuitFailures: Math.max(0, Number(config[REMEDIATOR_CIRCUIT_FAILURES_KEY] ?? 0) || 0),
    timeoutMs
  };
};

export const resolveRemediatorSecret = (
  configJson: Record<string, unknown> | null | undefined,
  secretRef?: string | null
): string | null => {
  const config = asRecord(configJson);
  const enc = config[REMEDIATOR_SECRET_ENC_KEY];
  if (enc && typeof enc === "object" && !Array.isArray(enc)) {
    try {
      return decryptSecret(enc as EncryptedSecret);
    } catch {
      return null;
    }
  }
  if (secretRef) {
    const fromRef = resolveConnectionSecretReference(secretRef);
    if (fromRef) return fromRef;
  }
  const inline = config[REMEDIATOR_SECRET_CONFIG_KEY];
  if (typeof inline === "string" && inline.trim()) {
    return inline.trim();
  }
  return null;
};

export const resolveRemediatorSecretAsync = async (input: {
  organizationId: string;
  projectId: string;
  environment?: string | null;
  credentialFamilyId?: string | null;
  integrationId?: string | null;
  configJson: Record<string, unknown> | null | undefined;
  secretRef?: string | null;
}): Promise<string | null> => {
  if (input.credentialFamilyId) {
    const managed = await resolveActiveSecrets({
      organizationId: input.organizationId,
      familyId: input.credentialFamilyId,
      projectId: input.projectId,
      environment: input.environment ?? null
    });
    if (managed.length > 0) return managed[0]?.plaintext ?? null;
  }

  const config = asRecord(input.configJson);
  const enc = config[REMEDIATOR_SECRET_ENC_KEY];
  if (enc && typeof enc === "object" && !Array.isArray(enc)) {
    try {
      return decryptSecret(enc as EncryptedSecret);
    } catch {
      return null;
    }
  }

  if (input.secretRef) {
    const fromRef = resolveConnectionSecretReference(input.secretRef);
    if (fromRef) return fromRef;
  }

  const inline = config[REMEDIATOR_SECRET_CONFIG_KEY];
  if (typeof inline === "string" && inline.trim()) {
    return inline.trim();
  }

  return null;
};

export const upsertRemediatorManagedCredential = async (input: {
  organizationId: string;
  projectId: string;
  integrationId: string;
  environment: string;
  plaintext: string;
  existingFamilyId?: string | null;
  actorUserId?: string | null;
}): Promise<{ familyId: string; legacyEncrypted: EncryptedSecret }> => {
  const created = await createCredentialVersion({
    organizationId: input.organizationId,
    familyId: input.existingFamilyId ?? undefined,
    projectId: input.projectId,
    integrationId: input.integrationId,
    purpose: "REMEDIATOR",
    credentialType: "HMAC_SECRET",
    environment: input.environment,
    plaintext: input.plaintext,
    createdBy: input.actorUserId ?? null,
    gracePeriodMs: input.existingFamilyId ? 24 * 60 * 60 * 1000 : null,
    actorUserId: input.actorUserId ?? null
  });
  return {
    familyId: created.familyId,
    legacyEncrypted: encryptSecret(input.plaintext)
  };
};

/**
 * Merge inbound config with existing row: encrypt new secrets, blank-preserve on empty,
 * and never leave plaintext secret in the stored JSON.
 */
export const mergeRemediatorConfigForStorage = (
  type: IntegrationType | string,
  incoming: Record<string, unknown> | null | undefined,
  existing: Record<string, unknown> | null | undefined
): Record<string, unknown> => {
  const next = { ...asRecord(existing), ...asRecord(incoming) };
  const incomingSecret = next[REMEDIATOR_SECRET_CONFIG_KEY];
  const existingEnc = asRecord(existing)[REMEDIATOR_SECRET_ENC_KEY];

  if (typeof incomingSecret === "string" && incomingSecret.trim()) {
    next[REMEDIATOR_SECRET_ENC_KEY] = encryptSecret(incomingSecret.trim());
  } else if (existingEnc) {
    next[REMEDIATOR_SECRET_ENC_KEY] = existingEnc;
  }

  delete next[REMEDIATOR_SECRET_CONFIG_KEY];

  if (isRemediatorProviderType(String(type))) {
    const caps = parseCapabilities(next[REMEDIATOR_CAPABILITIES_KEY]);
    if (caps.length === 0) {
      next[REMEDIATOR_CAPABILITIES_KEY] = [
        ...DEFAULT_CAPABILITIES[String(type) as RemediatorProviderType]
      ];
    } else {
      next[REMEDIATOR_CAPABILITIES_KEY] = caps;
    }
  }

  return next;
};

/** Strip secret material before returning ProjectIntegration to clients. */
export const redactRemediatorConfigForApi = (
  configJson: Record<string, unknown> | null | undefined,
  options?: {
    secretRef?: string | null;
    credential?: CredentialMetadataDto | null;
  }
): { configJson: Record<string, unknown> | null; secretConfigured: boolean; credential: CredentialMetadataDto | null } => {
  if (!configJson) {
    return {
      configJson: null,
      secretConfigured: Boolean(options?.credential?.configured || options?.secretRef),
      credential: options?.credential ?? null
    };
  }
  const redacted = { ...asRecord(configJson) };
  const secretConfigured = Boolean(
    options?.credential?.configured ||
      options?.secretRef ||
      redacted[REMEDIATOR_SECRET_ENC_KEY] ||
      (typeof redacted[REMEDIATOR_SECRET_CONFIG_KEY] === "string" &&
        redacted[REMEDIATOR_SECRET_CONFIG_KEY].trim())
  );
  delete redacted[REMEDIATOR_SECRET_ENC_KEY];
  delete redacted[REMEDIATOR_SECRET_CONFIG_KEY];
  return {
    configJson: redacted,
    secretConfigured,
    credential: options?.credential ?? null
  };
};

export const withCircuitState = (
  configJson: Record<string, unknown> | null | undefined,
  input: { failures: number; openUntil: Date | null }
): Record<string, unknown> => {
  const next = { ...asRecord(configJson) };
  next[REMEDIATOR_CIRCUIT_FAILURES_KEY] = input.failures;
  if (input.openUntil) {
    next[REMEDIATOR_CIRCUIT_OPEN_UNTIL_KEY] = input.openUntil.toISOString();
  } else {
    delete next[REMEDIATOR_CIRCUIT_OPEN_UNTIL_KEY];
  }
  return next;
};
