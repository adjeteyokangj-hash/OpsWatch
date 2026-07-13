import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSavedIntegrationDetails,
  validateIntegrationConnectivity
} from "./integration-validation.service";

describe("integration-validation.service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STRIPE_API_KEY;
  });

  it("marks saved Stripe configuration before validation", () => {
    const details = buildSavedIntegrationDetails("STRIPE", {
      STRIPE_API_KEY: "sk_test_123",
      STRIPE_API_BASE: "https://api.stripe.com"
    });

    expect(details.connectionState).toBe("saved");
    expect(details.account?.mode).toBe("test");
    expect(details.webhook?.configured).toBe(false);
    expect(details.checks.some((check) => check.label === "Webhook secret" && check.status === "warn")).toBe(true);
  });

  it("reports missing Stripe secret key", async () => {
    const result = await validateIntegrationConnectivity({
      type: "STRIPE",
      enabled: true,
      configJson: { STRIPE_API_BASE: "https://api.stripe.com" }
    });

    expect(result.status).toBe("INVALID");
    expect(result.details.missingFields).toContain("Secret key");
  });

  it("validates Stripe connectivity with account details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ available: [] })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          business_profile: { name: "OpsWatch Ltd" },
          livemode: false
        })
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await validateIntegrationConnectivity({
      type: "STRIPE",
      enabled: true,
      configJson: {
        STRIPE_API_KEY: "sk_test_123",
        STRIPE_WEBHOOK_SECRET: "whsec_123",
        STRIPE_API_BASE: "https://api.stripe.com"
      }
    });

    expect(result.status).toBe("VALID");
    expect(result.message).toContain("Successfully connected");
    expect(result.details.account).toMatchObject({
      name: "OpsWatch Ltd",
      mode: "test"
    });
    expect(result.details.checks.some((check) => check.id === "credentials" && check.status === "pass")).toBe(true);
  });
});
