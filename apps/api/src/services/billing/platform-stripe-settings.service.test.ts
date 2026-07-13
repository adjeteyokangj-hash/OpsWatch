import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpsert, mockFindMany } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpsert: vi.fn(),
  mockFindMany: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    platformStripeSettings: {
      findUnique: mockFindUnique,
      upsert: mockUpsert
    },
    projectIntegration: {
      findMany: mockFindMany
    }
  }
}));

import {
  PLATFORM_STRIPE_SETTINGS_ID,
  disconnectPlatformStripeSettings,
  getPlatformStripeSettings,
  resolvePlatformStripeCredentials,
  resolvePlatformWebhookSecret
} from "./platform-stripe-settings.service";

describe("platform-stripe-settings.service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    process.env.JWT_SECRET = "test-jwt-secret-for-encryption";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null credentials when database and env are unset", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await resolvePlatformStripeCredentials()).toBeNull();
    const view = await getPlatformStripeSettings();
    expect(view.configured).toBe(false);
    expect(view.credentialSource).toBe("none");
    expect(view.secretKeyMasked).toBeNull();
  });

  it("prefers database credentials over environment fallback", async () => {
    const { encryptSecret } = await import("../../lib/secret-crypto");
    const encrypted = encryptSecret("sk_test_db_key_1234567890");
    mockFindUnique.mockResolvedValue({
      id: PLATFORM_STRIPE_SETTINGS_ID,
      secretKeyCiphertext: encrypted.ciphertext,
      secretKeyIv: encrypted.iv,
      secretKeyAuthTag: encrypted.authTag,
      webhookSecretCiphertext: null,
      webhookSecretIv: null,
      webhookSecretAuthTag: null,
      publishableKey: "pk_test_db",
      stripeAccountId: null,
      apiBase: "https://api.stripe.com",
      mode: null,
      validationStatus: "UNKNOWN",
      validationMessage: null,
      validationDetails: null,
      lastValidatedAt: null
    });
    process.env.STRIPE_SECRET_KEY = "sk_test_env_should_not_win";

    const credentials = await resolvePlatformStripeCredentials();
    expect(credentials?.secretKey).toBe("sk_test_db_key_1234567890");
    expect(credentials?.source).toBe("database");
    expect(credentials?.publishableKey).toBe("pk_test_db");
  });

  it("falls back to environment credentials when database secret is absent", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.STRIPE_SECRET_KEY = "sk_test_env_key_1234567890";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_env_1234567890";

    const credentials = await resolvePlatformStripeCredentials();
    expect(credentials?.source).toBe("environment");
    expect(credentials?.secretKey).toBe("sk_test_env_key_1234567890");
    expect(await resolvePlatformWebhookSecret()).toBe("whsec_env_1234567890");

    const view = await getPlatformStripeSettings();
    expect(view.credentialSource).toBe("environment");
    expect(view.secretKeyMasked).not.toContain("sk_test_env");
  });

  it("clears database credentials on disconnect but preserves env fallback availability", async () => {
    mockUpsert.mockResolvedValue({
      id: PLATFORM_STRIPE_SETTINGS_ID,
      publishableKey: null,
      secretKeyCiphertext: null,
      secretKeyIv: null,
      secretKeyAuthTag: null,
      webhookSecretCiphertext: null,
      webhookSecretIv: null,
      webhookSecretAuthTag: null,
      stripeAccountId: null,
      apiBase: "https://api.stripe.com",
      mode: null,
      validationStatus: "UNKNOWN",
      validationMessage: "Stripe disconnected.",
      validationDetails: null,
      lastValidatedAt: null
    });
    mockFindUnique.mockResolvedValue(null);
    process.env.STRIPE_SECRET_KEY = "sk_test_env_after_disconnect";

    const view = await disconnectPlatformStripeSettings();
    expect(view.validationMessage).toBe("Stripe disconnected.");
    expect(view.credentialSource).toBe("environment");
    expect(view.configured).toBe(true);
  });

  it("lists legacy project Stripe integrations without exposing secret values", async () => {
    mockFindMany.mockResolvedValue([
      {
        id: "int-1",
        projectId: "proj-1",
        enabled: true,
        validationStatus: "VALID",
        lastValidatedAt: new Date("2026-07-01T00:00:00.000Z"),
        configJson: {
          STRIPE_API_KEY: "sk_test_legacy_secret",
          STRIPE_WEBHOOK_SECRET: "whsec_legacy"
        },
        Project: {
          id: "proj-1",
          name: "Legacy App",
          slug: "legacy-app",
          organizationId: "org-1"
        }
      }
    ]);

    const { listLegacyProjectStripeIntegrations } = await import("./platform-stripe-settings.service");
    const rows = await listLegacyProjectStripeIntegrations();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.hasSecretKey).toBe(true);
    expect(rows[0]?.hasWebhookSecret).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain("sk_test_legacy_secret");
    expect(JSON.stringify(rows[0])).not.toContain("whsec_legacy");
  });
});
