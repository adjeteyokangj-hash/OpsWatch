import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hasActiveProjectIngestKey,
  projectHasProductInfo,
  provisionProjectIngestCredentials
} from "./project-ingest-credentials.service";

const { mockFindMany, mockFindFirst, mockCreate } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindFirst: vi.fn(),
  mockCreate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    orgApiKey: {
      findMany: mockFindMany,
      findFirst: mockFindFirst,
      create: mockCreate
    }
  }
}));

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
    expect(result.scopes).toEqual(["events:write", "heartbeats:write"]);
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("reuses an existing active ingest key", async () => {
    mockFindMany.mockResolvedValue([{ scopes: ["events:write", "heartbeats:write"] }]);
    mockFindFirst.mockResolvedValue({ keyId: "ow_existing" });

    const result = await provisionProjectIngestCredentials({
      organizationId: "org-1",
      projectId: "project-1",
      projectName: "Noble Express",
      projectSlug: "noble-express",
      signingSecret: "signing-secret"
    });

    expect(result.reused).toBe(true);
    expect(result.apiKey).toBe("");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reports active ingest keys", async () => {
    mockFindMany.mockResolvedValue([{ scopes: ["events:write", "heartbeats:write"] }]);
    await expect(hasActiveProjectIngestKey("org-1", "project-1")).resolves.toBe(true);
  });
});
