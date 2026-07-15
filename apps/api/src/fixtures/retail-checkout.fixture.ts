/**
 * Test/development-only fixture declarations. They are never seeded by the
 * application and deliberately contain no credentials or production targets.
 *
 * Scenario A (Phase 6): external payment dependency failure groups into one
 * primary incident with supporting alerts and an evidence-ranked recovery path.
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
  ],
  scenarioA: {
    name: "External payment provider outage cascade",
    entities: [
      { key: "online-store", type: "SYSTEM", name: "Online Store" },
      { key: "checkout", type: "MODULE", name: "Checkout" },
      { key: "customer-checkout-workflow", type: "WORKFLOW", name: "Customer Checkout Workflow" },
      { key: "payment-api", type: "COMPONENT", name: "Payment API" },
      { key: "external-payment-provider", type: "EXTERNAL_DEPENDENCY", name: "External Payment Provider" }
    ],
    dependencies: [
      { from: "online-store", to: "checkout" },
      { from: "checkout", to: "customer-checkout-workflow" },
      { from: "customer-checkout-workflow", to: "payment-api" },
      { from: "payment-api", to: "external-payment-provider" }
    ],
    expectedPrimaryRootCauseKey: "external-payment-provider",
    supportingAlertTitles: [
      "External Payment Provider failing",
      "Payment API unhealthy",
      "Customer Checkout Workflow degraded"
    ],
    recoverySignal: "External Payment Provider recovered"
  }
};
