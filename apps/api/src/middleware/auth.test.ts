import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../utils/crypto";

const { mockFindFirst, mockUpdate, mockUpdateMany, mockAuditCreate } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockAuditCreate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    orgApiKey: {
      findFirst: mockFindFirst,
      update: mockUpdate,
      updateMany: mockUpdateMany
    },
    auditLog: {
      create: mockAuditCreate
    }
  }
}));

vi.mock("../services/credentials/credential-audit.service", () => ({
  recordCredentialAudit: (input: unknown) => mockAuditCreate(input)
}));

import {
  authorizeApiKey,
  resetApiKeyRateLimitBucketsForTests,
  type AuthRequest
} from "./auth";

const buildRequest = (apiKey: string, extras: Partial<AuthRequest> = {}): AuthRequest =>
  ({
    header: (name: string) => {
      if (name.toLowerCase() === "x-api-key") return apiKey;
      return extras.header?.(name) ?? undefined;
    },
    originalUrl: "/api/event",
    path: "/api/event",
    ip: "127.0.0.1",
    ...extras
  }) as AuthRequest;

describe("authorizeApiKey", () => {
  const keyId = "ow_abc123";
  const secret = "super-secret-value";
  const fullKey = `${keyId}.${secret}`;

  beforeEach(() => {
    vi.clearAllMocks();
    resetApiKeyRateLimitBucketsForTests();
    mockUpdate.mockResolvedValue({});
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockAuditCreate.mockResolvedValue(undefined);
  });

  it("rejects expired keys", async () => {
    mockFindFirst.mockResolvedValue({
      id: "key-1",
      organizationId: "org-1",
      secretHash: sha256(secret),
      scopes: ["events:write"],
      environment: "live",
      projectId: null,
      expiresAt: new Date(Date.now() - 60_000),
      revokedAt: null,
      graceExpiresAt: null,
      allowCrossEnvironment: false
    });

    const result = await authorizeApiKey(buildRequest(fullKey), ["events:write"]);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects revoked keys", async () => {
    mockFindFirst.mockResolvedValue({
      id: "key-1",
      organizationId: "org-1",
      secretHash: sha256(secret),
      scopes: ["events:write"],
      environment: "live",
      projectId: null,
      expiresAt: null,
      revokedAt: new Date(),
      graceExpiresAt: null,
      allowCrossEnvironment: false
    });

    const result = await authorizeApiKey(buildRequest(fullKey), ["events:write"]);
    expect(result).toEqual({ ok: false, reason: "revoked" });
  });

  it("accepts valid keys and updates last-used metadata", async () => {
    mockFindFirst.mockResolvedValue({
      id: "key-1",
      organizationId: "org-1",
      secretHash: sha256(secret),
      scopes: ["events:write"],
      environment: "live",
      projectId: null,
      expiresAt: null,
      revokedAt: null,
      graceExpiresAt: null,
      allowCrossEnvironment: false
    });

    const req = buildRequest(fullKey);
    const result = await authorizeApiKey(req, ["events:write"]);

    expect(result).toEqual({ ok: true });
    expect(req.apiKeyId).toBe("key-1");
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key-1" },
        data: expect.objectContaining({
          lastUsedRoute: "/api/event",
          lastUsedIp: "127.0.0.1"
        })
      })
    );
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREDENTIAL_USED",
        entityType: "OrgApiKey",
        entityId: "key-1"
      })
    );
  });

  it("uses timing-safe hash comparison and rejects invalid secrets", async () => {
    mockFindFirst.mockResolvedValue({
      id: "key-1",
      organizationId: "org-1",
      secretHash: sha256(secret),
      scopes: ["events:write"],
      environment: "live",
      projectId: null,
      expiresAt: null,
      revokedAt: null,
      graceExpiresAt: null,
      allowCrossEnvironment: false
    });

    const result = await authorizeApiKey(buildRequest(`${keyId}.wrong-secret`), ["events:write"]);
    expect(result).toEqual({ ok: false, reason: "invalid" });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AUTH_FAILED",
        metadata: expect.objectContaining({ reason: "invalid" })
      })
    );
  });

  it("allows rotated keys during grace and rejects after grace expires", async () => {
    mockFindFirst.mockResolvedValue({
      id: "key-old",
      organizationId: "org-1",
      secretHash: sha256(secret),
      scopes: ["events:write"],
      environment: "live",
      projectId: null,
      expiresAt: null,
      revokedAt: null,
      graceExpiresAt: new Date(Date.now() + 60_000),
      allowCrossEnvironment: false
    });

    const active = await authorizeApiKey(buildRequest(fullKey), ["events:write"]);
    expect(active).toEqual({ ok: true });

    mockFindFirst.mockResolvedValue({
      id: "key-old",
      organizationId: "org-1",
      secretHash: sha256(secret),
      scopes: ["events:write"],
      environment: "live",
      projectId: null,
      expiresAt: null,
      revokedAt: null,
      graceExpiresAt: new Date(Date.now() - 1_000),
      allowCrossEnvironment: false
    });

    const expired = await authorizeApiKey(buildRequest(fullKey), ["events:write"]);
    expect(expired).toEqual({ ok: false, reason: "revoked" });
  });
});
