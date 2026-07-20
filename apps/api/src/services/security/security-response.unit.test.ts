import { describe, expect, it, vi, beforeEach } from "vitest";

const mockOrgApiKeyFindFirst = vi.fn();
const mockOrgApiKeyUpdate = vi.fn();
const mockOrgApiKeyFindUnique = vi.fn();
const mockResponseCreate = vi.fn();
const mockResponseUpdate = vi.fn();
const mockFindingUpdate = vi.fn();
const mockAudit = vi.fn();

vi.mock("../../lib/prisma", () => ({
  prisma: {
    orgApiKey: {
      findFirst: (...args: unknown[]) => mockOrgApiKeyFindFirst(...args),
      update: (...args: unknown[]) => mockOrgApiKeyUpdate(...args),
      findUnique: (...args: unknown[]) => mockOrgApiKeyFindUnique(...args)
    },
    securityResponseRun: {
      create: (...args: unknown[]) => mockResponseCreate(...args),
      update: (...args: unknown[]) => mockResponseUpdate(...args)
    },
    securityFinding: {
      update: (...args: unknown[]) => mockFindingUpdate(...args)
    },
    securityEvent: {
      findFirst: vi.fn(),
      update: vi.fn()
    },
    connection: {
      findFirst: vi.fn(),
      update: vi.fn()
    }
  }
}));

vi.mock("../credentials/credential-audit.service", () => ({
  recordCredentialAudit: (...args: unknown[]) => mockAudit(...args)
}));

import { createSecurityResponseRun } from "./security-response.service";

describe("security response", () => {
  beforeEach(() => {
    mockOrgApiKeyFindFirst.mockReset();
    mockOrgApiKeyUpdate.mockReset();
    mockOrgApiKeyFindUnique.mockReset();
    mockResponseCreate.mockReset();
    mockResponseUpdate.mockReset();
    mockFindingUpdate.mockReset();
    mockAudit.mockReset();
    mockResponseCreate.mockImplementation(async ({ data }: { data: { id: string } }) => data);
    mockResponseUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "run-1",
      ...data
    }));
  });

  it("records observe-only recommendations without executing", async () => {
    const result = await createSecurityResponseRun({
      organizationId: "org-1",
      actionKey: "REVOKE_ORG_API_KEY",
      automationMode: "OBSERVE",
      findingId: "finding-1"
    });
    expect(result.status).toBe("OBSERVED");
    expect(mockOrgApiKeyUpdate).not.toHaveBeenCalled();
  });

  it("revokes an OpsWatch API key and verifies revokedAt", async () => {
    mockOrgApiKeyFindFirst.mockResolvedValue({
      id: "key-1",
      organizationId: "org-1",
      revokedAt: null
    });
    mockOrgApiKeyFindUnique.mockResolvedValue({
      id: "key-1",
      revokedAt: new Date()
    });

    const result = await createSecurityResponseRun({
      organizationId: "org-1",
      actionKey: "REVOKE_ORG_API_KEY",
      automationMode: "APPROVAL",
      findingId: "finding-1",
      context: { orgApiKeyId: "key-1" }
    });

    expect(mockOrgApiKeyUpdate).toHaveBeenCalled();
    expect(result.status).toBe("VERIFIED");
    expect(mockFindingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "CONTAINING" })
      })
    );
  });

  it("returns setup required for unsupported action keys", async () => {
    const result = await createSecurityResponseRun({
      organizationId: "org-1",
      // @ts-expect-error intentional unsupported
      actionKey: "BLOCK_ENTIRE_NETWORK",
      automationMode: "APPROVAL"
    });
    expect(result.status).toBe("SETUP_REQUIRED");
  });
});
