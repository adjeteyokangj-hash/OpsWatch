import { afterEach, describe, expect, it, vi } from "vitest";

const { update, auditCreate, ledgerCreate } = vi.hoisted(() => ({
  update: vi.fn(),
  auditCreate: vi.fn(),
  ledgerCreate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    connection: { update },
    auditLog: { create: auditCreate },
    changeLedgerEntry: { create: ledgerCreate },
    deploymentRecord: { create: vi.fn() }
  }
}));

import {
  resolveConnectionSecretReference,
  testAgentlessConnection
} from "./agentless-connection.service";

describe("agentless connection runner", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("performs a real HTTP probe and stores its factual outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    update.mockResolvedValue({});
    auditCreate.mockResolvedValue({});
    ledgerCreate.mockResolvedValue({ id: "ledger-1" });

    const result = await testAgentlessConnection({
      id: "connection-1",
      organizationId: "org-1",
      projectId: "project-1",
      name: "Checkout health",
      mode: "AGENTLESS",
      configurationJson: { endpoint: "https://checkout.example.test/health", method: "GET", timeoutMs: 1000 },
      secretRef: null
    });

    expect(result).toMatchObject({ succeeded: true, statusCode: 204 });
    expect(fetch).toHaveBeenCalledWith("https://checkout.example.test/health", expect.objectContaining({ method: "GET" }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ health: "HEALTHY" }) }));
    expect(ledgerCreate).toHaveBeenCalled();
  });

  it("resolves only explicit environment secret references", () => {
    process.env.OPSWATCH_TEST_WEBHOOK_SECRET = "test-secret";
    expect(resolveConnectionSecretReference("env://OPSWATCH_TEST_WEBHOOK_SECRET")).toBe("test-secret");
    expect(resolveConnectionSecretReference("vault://not-implemented")).toBeNull();
    delete process.env.OPSWATCH_TEST_WEBHOOK_SECRET;
  });
});
