/**
 * Test/development-only fixture declarations. They are never seeded by the
 * application and deliberately contain no credentials or production targets.
 */
export const retailCheckoutFixture = {
  organization: { name: "Harbor Retail", slug: "harbor-retail-test" },
  project: { name: "Online Checkout", slug: "online-checkout-test" },
  connections: [
    {
      name: "Checkout storefront health",
      type: "HTTP endpoint",
      mode: "AGENTLESS",
      authMethod: "NONE",
      capabilities: ["health_check", "latency"],
      configuration: { endpoint: "http://127.0.0.1:0/checkout/health", method: "GET", timeoutMs: 1000 }
    },
    {
      name: "Payment provider deployment feed",
      type: "Signed deployment webhook",
      mode: "WEBHOOK",
      authMethod: "HMAC",
      capabilities: ["event_ingest", "deployment_events"],
      secretRef: "env://OPSWATCH_TEST_PAYMENT_WEBHOOK_SECRET"
    }
  ],
  events: [
    {
      kind: "DEPLOYMENT" as const,
      summary: "Payment provider adapter deployed",
      externalId: "test-payment-deploy-001",
      evidence: { version: "2026.07.15-test", commitSha: "test-only", branch: "test" }
    }
  ]
};
