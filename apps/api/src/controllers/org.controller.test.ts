import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../utils/crypto";

const { mockFindFirst, mockTransaction, mockAuditCreate, mockProjectFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockAuditCreate: vi.fn(),
  mockProjectFindFirst: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    orgApiKey: {
      findFirst: mockFindFirst,
      update: vi.fn(),
      create: vi.fn()
    },
    project: {
      findFirst: mockProjectFindFirst
    },
    $transaction: mockTransaction
  }
}));

vi.mock("../services/credentials/credential-audit.service", () => ({
  recordCredentialAudit: (input: unknown) => mockAuditCreate(input)
}));

import { rotateApiKey } from "./org.controller";
import type { AuthRequest } from "../middleware/auth";

describe("rotateApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuditCreate.mockResolvedValue(undefined);
  });

  it("creates a replacement key and sets grace on the old key", async () => {
    const existing = {
      id: "old-key",
      organizationId: "org-1",
      name: "Ingest",
      secretHash: sha256("old-secret"),
      scopes: ["events:write"],
      environment: "live",
      projectId: "project-1",
      expiresAt: null,
      revokedAt: null,
      allowCrossEnvironment: false
    };

    mockFindFirst.mockResolvedValueOnce(existing);
    mockProjectFindFirst.mockResolvedValue({ id: "project-1", name: "Demo" });

    const createdAt = new Date();
    mockTransaction.mockImplementation(async (callback) =>
      callback({
        orgApiKey: {
          update: vi.fn().mockResolvedValue({}),
          create: vi.fn().mockResolvedValue({
            id: "new-key",
            organizationId: "org-1",
            name: "Ingest",
            keyId: "ow_newkey123456",
            scopes: ["events:write"],
            environment: "live",
            projectId: "project-1",
            expiresAt: null,
            createdAt
          })
        }
      })
    );

    const req = {
      params: { keyId: "old-key" },
      body: {},
      user: { organizationId: "org-1", id: "user-1" }
    } as unknown as AuthRequest;

    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      }
    };

    await rotateApiKey(req, res as any);

    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: "new-key",
        key: expect.stringMatching(/^ow_[a-f0-9]+\.[A-Za-z0-9_-]+$/),
        graceExpiresAt: expect.any(String)
      })
    );
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "CREDENTIAL_ROTATED",
        entityType: "OrgApiKey",
        entityId: "new-key"
      })
    );
  });
});
