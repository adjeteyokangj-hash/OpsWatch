import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindMany, mockFindFirst, mockCreate, mockProjectFindUnique, mockManagedFindFirst } = vi.hoisted(
  () => ({
    mockFindMany: vi.fn(),
    mockFindFirst: vi.fn(),
    mockCreate: vi.fn(),
    mockProjectFindUnique: vi.fn(),
    mockManagedFindFirst: vi.fn()
  })
);

vi.mock("../lib/prisma", () => ({
  prisma: {
    orgApiKey: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockCreate
    },
    project: {
      findUnique: mockProjectFindUnique
    },
    managedCredential: {
      findFirst: mockManagedFindFirst
    }
  }
}));

vi.mock("./credentials/managed-credential.service", () => ({
  createCredentialVersion: vi.fn()
}));

import {
  hasActiveProjectIngestKey,
  projectHasProductInfo,
  provisionProjectIngestCredentials
} from "./project-ingest-credentials.service";

describe("project ingest credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects when product information is complete enough to provision ingest", () => {
    expect(
      projectHasProductInfo({
        name: "Noble Express",
        clientName: "Noble",
        frontendUrl: "https://noble.example.com"
      })
    ).toBe(true);
    expect(projectHasProductInfo({ name: "Noble Express", clientName: "Noble" })).toBe(false);
  });

  it("creates a scoped org API key for a new project", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: "key-1" });

    const result = await provisionProjectIngestCredentials({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Noble Express",
      projectSlug: "noble-express",
      signingSecret: "signing-secret"
    });

    expect(result.reused).toBe(false);
    expect(result.apiKey).toMatch(/^ow_[a-f0-9]+\.[A-Za-z0-9_-]+$/);
    expect(result.signingSecret).toBe("signing-secret");
    expect(result.signingSecretConfigured).toBe(true);
    expect(result.scopes).toEqual(["events:write", "heartbeats:write"]);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("reuses an existing active ingest key without returning signing secret plaintext", async () => {
    mockFindMany.mockResolvedValue([{ scopes: ["events:write", "heartbeats:write"] }]);
    mockFindFirst.mockResolvedValue({ keyId: "ow_existing" });
    mockProjectFindUnique.mockResolvedValue({
      signingSecret: "stored-secret",
      signingSecretRotatedAt: new Date("2026-01-01T00:00:00.000Z"),
      signingCredentialFamilyId: "family-1",
      organizationId: "org-1"
    });
    mockManagedFindFirst.mockResolvedValue({ version: 2 });

    const result = await provisionProjectIngestCredentials({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Noble Express",
      projectSlug: "noble-express",
      signingSecret: "signing-secret"
    });

    expect(result.reused).toBe(true);
    expect(result.apiKey).toBe("");
    expect(result.signingSecret).toBe("");
    expect(result.signingSecretConfigured).toBe(true);
    expect(result.lastRotatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.keyVersion).toBe(2);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reports active ingest keys", async () => {
    mockFindMany.mockResolvedValue([{ scopes: ["events:write", "heartbeats:write"] }]);
    await expect(hasActiveProjectIngestKey("org-1", "project-1")).resolves.toBe(true);
  });
});
