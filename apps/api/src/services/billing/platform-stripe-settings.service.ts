import { randomUUID } from "crypto";
import { Prisma, type IntegrationValidationStatus, type PlatformStripeSettings } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { decryptSecret, encryptSecret, maskSecret } from "../../lib/secret-crypto";

export const PLATFORM_STRIPE_SETTINGS_ID = "platform";

export type StripeCredentialBundle = {
  secretKey: string;
  webhookSecret?: string;
  publishableKey?: string;
  apiBase: string;
  source: "database" | "environment";
};

export type PlatformStripeSettingsView = {
  configured: boolean;
  publishableKey: string | null;
  secretKeyMasked: string | null;
  webhookSecretMasked: string | null;
  stripeAccountId: string | null;
  apiBase: string;
  mode: "test" | "live" | null;
  validationStatus: IntegrationValidationStatus;
  validationMessage: string | null;
  validationDetails: Record<string, unknown> | null;
  lastValidatedAt: string | null;
  credentialSource: "database" | "environment" | "none";
};

type ValidationDetails = {
  connectionState: "not_configured" | "saved" | "connected" | "failed";
  health: "healthy" | "degraded" | "unhealthy" | "unknown";
  checks: Array<{ id: string; label: string; status: "pass" | "fail" | "warn" | "pending"; detail?: string }>;
  account?: { name?: string; mode?: "test" | "live"; apiVersion?: string; id?: string };
  webhook?: { configured: boolean; verified: boolean };
  lastCheckedAt: string;
};

const detectStripeMode = (apiKey: string, livemode?: boolean): "test" | "live" => {
  if (apiKey.startsWith("sk_live_") || apiKey.startsWith("rk_live_")) return "live";
  if (apiKey.startsWith("sk_test_") || apiKey.startsWith("rk_test_")) return "test";
  if (livemode === true) return "live";
  if (livemode === false) return "test";
  return "test";
};

const readEncrypted = (row: PlatformStripeSettings, field: "secret" | "webhook"): string | undefined => {
  const ciphertext = field === "secret" ? row.secretKeyCiphertext : row.webhookSecretCiphertext;
  const iv = field === "secret" ? row.secretKeyIv : row.webhookSecretIv;
  const authTag = field === "secret" ? row.secretKeyAuthTag : row.webhookSecretAuthTag;
  if (!ciphertext || !iv || !authTag) return undefined;
  return decryptSecret({ ciphertext, iv, authTag });
};

const hasStoredSecret = (row: PlatformStripeSettings | null | undefined): boolean =>
  Boolean(row?.secretKeyCiphertext && row.secretKeyIv && row.secretKeyAuthTag);

export const resolvePlatformStripeCredentials = async (): Promise<StripeCredentialBundle | null> => {
  const row = await prisma.platformStripeSettings.findUnique({
    where: { id: PLATFORM_STRIPE_SETTINGS_ID }
  });

  if (row && hasStoredSecret(row)) {
    const secretKey = readEncrypted(row, "secret");
    if (secretKey) {
      return {
        secretKey,
        webhookSecret: readEncrypted(row, "webhook"),
        publishableKey: row.publishableKey ?? undefined,
        apiBase: row.apiBase || "https://api.stripe.com",
        source: "database"
      };
    }
  }

  const envSecret = process.env.STRIPE_SECRET_KEY?.trim();
  if (envSecret) {
    return {
      secretKey: envSecret,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY?.trim() || undefined,
      apiBase: process.env.STRIPE_API_BASE?.trim() || "https://api.stripe.com",
      source: "environment"
    };
  }

  return null;
};

export const resolvePlatformWebhookSecret = async (): Promise<string | undefined> => {
  const credentials = await resolvePlatformStripeCredentials();
  return credentials?.webhookSecret;
};

const toView = (
  row: PlatformStripeSettings | null,
  credentials: StripeCredentialBundle | null
): PlatformStripeSettingsView => {
  const secretKey = credentials?.secretKey;
  const webhookSecret = credentials?.webhookSecret;

  return {
    configured: Boolean(secretKey),
    publishableKey: row?.publishableKey ?? credentials?.publishableKey ?? null,
    secretKeyMasked: maskSecret(secretKey),
    webhookSecretMasked: maskSecret(webhookSecret),
    stripeAccountId: row?.stripeAccountId ?? null,
    apiBase: row?.apiBase ?? credentials?.apiBase ?? "https://api.stripe.com",
    mode: (row?.mode as "test" | "live" | null) ?? (secretKey ? detectStripeMode(secretKey) : null),
    validationStatus: row?.validationStatus ?? "UNKNOWN",
    validationMessage: row?.validationMessage ?? null,
    validationDetails: (row?.validationDetails as Record<string, unknown> | null) ?? null,
    lastValidatedAt: row?.lastValidatedAt?.toISOString() ?? null,
    credentialSource: credentials?.source ?? "none"
  };
};

export const getPlatformStripeSettings = async (): Promise<PlatformStripeSettingsView> => {
  const row = await prisma.platformStripeSettings.findUnique({
    where: { id: PLATFORM_STRIPE_SETTINGS_ID }
  });
  const credentials = await resolvePlatformStripeCredentials();
  return toView(row, credentials);
};

export const savePlatformStripeSettings = async (input: {
  publishableKey?: string | null;
  secretKey?: string | null;
  webhookSecret?: string | null;
  apiBase?: string;
}): Promise<PlatformStripeSettingsView> => {
  const existing = await prisma.platformStripeSettings.findUnique({
    where: { id: PLATFORM_STRIPE_SETTINGS_ID }
  });

  const encryptedSecret =
    input.secretKey && input.secretKey.trim()
      ? encryptSecret(input.secretKey.trim())
      : existing?.secretKeyCiphertext
        ? {
            ciphertext: existing.secretKeyCiphertext,
            iv: existing.secretKeyIv as string,
            authTag: existing.secretKeyAuthTag as string
          }
        : null;

  if (!encryptedSecret && !(existing && hasStoredSecret(existing)) && !process.env.STRIPE_SECRET_KEY) {
    throw new Error("Secret key is required.");
  }

  let encryptedWebhook: ReturnType<typeof encryptSecret> | null = null;
  if (input.webhookSecret && input.webhookSecret.trim()) {
    encryptedWebhook = encryptSecret(input.webhookSecret.trim());
  } else if (existing?.webhookSecretCiphertext) {
    encryptedWebhook = {
      ciphertext: existing.webhookSecretCiphertext,
      iv: existing.webhookSecretIv as string,
      authTag: existing.webhookSecretAuthTag as string
    };
  }

  const now = new Date();
  const row = await prisma.platformStripeSettings.upsert({
    where: { id: PLATFORM_STRIPE_SETTINGS_ID },
    update: {
      publishableKey: input.publishableKey === undefined ? existing?.publishableKey : input.publishableKey || null,
      ...(encryptedSecret
        ? {
            secretKeyCiphertext: encryptedSecret.ciphertext,
            secretKeyIv: encryptedSecret.iv,
            secretKeyAuthTag: encryptedSecret.authTag
          }
        : {}),
      ...(encryptedWebhook
        ? {
            webhookSecretCiphertext: encryptedWebhook.ciphertext,
            webhookSecretIv: encryptedWebhook.iv,
            webhookSecretAuthTag: encryptedWebhook.authTag
          }
        : {}),
      apiBase: input.apiBase?.trim() || existing?.apiBase || "https://api.stripe.com",
      validationStatus: "UNKNOWN",
      validationMessage: "Configuration saved. Validate the connection to confirm health.",
      lastValidatedAt: null,
      updatedAt: now
    },
    create: {
      id: PLATFORM_STRIPE_SETTINGS_ID,
      publishableKey: input.publishableKey || null,
      secretKeyCiphertext: encryptedSecret?.ciphertext,
      secretKeyIv: encryptedSecret?.iv,
      secretKeyAuthTag: encryptedSecret?.authTag,
      webhookSecretCiphertext: encryptedWebhook?.ciphertext,
      webhookSecretIv: encryptedWebhook?.iv,
      webhookSecretAuthTag: encryptedWebhook?.authTag,
      apiBase: input.apiBase?.trim() || "https://api.stripe.com",
      validationStatus: "UNKNOWN",
      validationMessage: "Configuration saved. Validate the connection to confirm health.",
      updatedAt: now
    }
  });

  const credentials = await resolvePlatformStripeCredentials();
  return toView(row, credentials);
};

export const validatePlatformStripeSettings = async (): Promise<PlatformStripeSettingsView> => {
  const credentials = await resolvePlatformStripeCredentials();
  if (!credentials?.secretKey) {
    throw new Error("Stripe secret key is not configured.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let validationStatus: IntegrationValidationStatus = "INVALID";
  let validationMessage = "Stripe validation failed.";
  let details: ValidationDetails;
  let stripeAccountId: string | undefined;
  let mode = detectStripeMode(credentials.secretKey);

  try {
    const [balanceResponse, accountResponse] = await Promise.all([
      fetch(`${credentials.apiBase}/v1/balance`, {
        method: "GET",
        headers: { Authorization: `Bearer ${credentials.secretKey}` },
        signal: controller.signal
      }),
      fetch(`${credentials.apiBase}/v1/account`, {
        method: "GET",
        headers: { Authorization: `Bearer ${credentials.secretKey}` },
        signal: controller.signal
      })
    ]);

    const credentialsAccepted = balanceResponse.ok;
    let accountName: string | undefined;
    if (accountResponse.ok) {
      const account = (await accountResponse.json()) as {
        id?: string;
        business_profile?: { name?: string };
        settings?: { dashboard?: { display_name?: string } };
        livemode?: boolean;
      };
      stripeAccountId = account.id;
      accountName =
        account.business_profile?.name?.trim() ||
        account.settings?.dashboard?.display_name?.trim() ||
        undefined;
      mode = detectStripeMode(credentials.secretKey, account.livemode);
    }

    const webhookConfigured = Boolean(credentials.webhookSecret);
    const checks: ValidationDetails["checks"] = [
      { id: "api", label: "API reachable", status: balanceResponse.status !== 0 ? "pass" : "fail" },
      {
        id: "credentials",
        label: "Credentials accepted",
        status: credentialsAccepted ? "pass" : "fail",
        detail: credentialsAccepted ? undefined : `Stripe returned ${balanceResponse.status}`
      },
      {
        id: "webhook",
        label: "Webhook configured",
        status: webhookConfigured ? "pass" : "warn",
        detail: webhookConfigured ? undefined : "Webhook signing secret not configured"
      },
      { id: "checkout", label: "Checkout ready", status: credentialsAccepted ? "pass" : "fail" },
      { id: "portal", label: "Billing portal ready", status: credentialsAccepted ? "pass" : "fail" }
    ];

    if (credentialsAccepted) {
      validationStatus = "VALID";
      validationMessage = "Successfully connected to Stripe.";
      details = {
        connectionState: "connected",
        health: webhookConfigured ? "healthy" : "degraded",
        checks,
        account: { id: stripeAccountId, name: accountName, mode, apiVersion: "2026-06-30" },
        webhook: { configured: webhookConfigured, verified: webhookConfigured },
        lastCheckedAt: new Date().toISOString()
      };
    } else {
      details = {
        connectionState: "failed",
        health: "unhealthy",
        checks,
        account: { id: stripeAccountId, name: accountName, mode, apiVersion: "2026-06-30" },
        webhook: { configured: webhookConfigured, verified: false },
        lastCheckedAt: new Date().toISOString()
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    validationMessage = `Stripe validation error: ${message}`;
    details = {
      connectionState: "failed",
      health: "unhealthy",
      checks: [
        { id: "api", label: "API reachable", status: "fail", detail: message },
        { id: "credentials", label: "Credentials accepted", status: "fail" }
      ],
      lastCheckedAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeout);
  }

  const now = new Date();
  const row = await prisma.platformStripeSettings.upsert({
    where: { id: PLATFORM_STRIPE_SETTINGS_ID },
    update: {
      stripeAccountId: stripeAccountId ?? null,
      mode,
      validationStatus,
      validationMessage,
      validationDetails: details!,
      lastValidatedAt: now,
      updatedAt: now
    },
    create: {
      id: PLATFORM_STRIPE_SETTINGS_ID,
      stripeAccountId: stripeAccountId ?? null,
      mode,
      validationStatus,
      validationMessage,
      validationDetails: details!,
      lastValidatedAt: now,
      updatedAt: now
    }
  });

  const refreshedCredentials = await resolvePlatformStripeCredentials();
  return toView(row, refreshedCredentials);
};

export const disconnectPlatformStripeSettings = async (): Promise<PlatformStripeSettingsView> => {
  const now = new Date();
  const row = await prisma.platformStripeSettings.upsert({
    where: { id: PLATFORM_STRIPE_SETTINGS_ID },
    update: {
      publishableKey: null,
      secretKeyCiphertext: null,
      secretKeyIv: null,
      secretKeyAuthTag: null,
      webhookSecretCiphertext: null,
      webhookSecretIv: null,
      webhookSecretAuthTag: null,
      stripeAccountId: null,
      mode: null,
      validationStatus: "UNKNOWN",
      validationMessage: "Stripe disconnected.",
      validationDetails: Prisma.JsonNull,
      lastValidatedAt: null,
      updatedAt: now
    },
    create: {
      id: PLATFORM_STRIPE_SETTINGS_ID,
      validationStatus: "UNKNOWN",
      validationMessage: "Stripe disconnected.",
      updatedAt: now
    }
  });

  const credentials = await resolvePlatformStripeCredentials();
  return toView(row, credentials);
};

export const listLegacyProjectStripeIntegrations = async () => {
  const rows = await prisma.projectIntegration.findMany({
    where: { type: "STRIPE" },
    include: {
      Project: {
        select: {
          id: true,
          name: true,
          slug: true,
          organizationId: true
        }
      }
    },
    orderBy: [{ updatedAt: "desc" }]
  });

  return rows.map((row) => {
    const config = (row.configJson as Record<string, unknown> | null) ?? {};
    const hasSecretKey = typeof config.STRIPE_API_KEY === "string" && config.STRIPE_API_KEY.trim().length > 0;
    const hasWebhookSecret =
      typeof config.STRIPE_WEBHOOK_SECRET === "string" && config.STRIPE_WEBHOOK_SECRET.trim().length > 0;

    return {
      integrationId: row.id,
      projectId: row.projectId,
      projectName: row.Project.name,
      projectSlug: row.Project.slug,
      organizationId: row.Project.organizationId,
      enabled: row.enabled,
      validationStatus: row.validationStatus,
      lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
      hasSecretKey,
      hasWebhookSecret,
      note: "Manual review required. Do not auto-migrate project Stripe credentials into platform settings."
    };
  });
};
