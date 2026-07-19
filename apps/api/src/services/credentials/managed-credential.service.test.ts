import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  managedFindFirst,
  managedFindMany,
  managedFindUnique,
  managedCreate,
  managedUpdate,
  managedUpdateMany,
  transaction,
  auditCreate
} = vi.hoisted(() => ({
  managedFindFirst: vi.fn(),
  managedFindMany: vi.fn(),
  managedFindUnique: vi.fn(),
  managedCreate: vi.fn(),
  managedUpdate: vi.fn(),
  managedUpdateMany: vi.fn(),
  transaction: vi.fn(),
  auditCreate: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    managedCredential: {
      findFirst: managedFindFirst,
      findMany: managedFindMany,
      findUnique: managedFindUnique,
      create: managedCreate,
      update: managedUpdate,
      updateMany: managedUpdateMany
    },
    auditLog: { create: auditCreate },
    $transaction: transaction
  }
}));

import {
  createCredentialVersion,
  resolveActiveSecrets,
  revokeCredentialFamily,
  rotateCredential,
  toCredentialMetadataDto
} from "./managed-credential.service";

describe("managed-credential.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY = "test-managed-key";
    auditCreate.mockResolvedValue({});

    transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        managedCredential: {
          findMany: managedFindMany,
          update: managedUpdate,
          create: managedCreate
        }
      })
    );
  });

  it("creates the first credential version as ACTIVE", async () => {
    managedFindFirst.mockResolvedValue(null);
    managedFindMany.mockResolvedValue([]);
    managedCreate.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date("2026-07-19T10:00:00.000Z")
    }));

    const created = await createCredentialVersion({
      organizationId: "org-1",
      familyId: "family-1",
      projectId: "project-1",
      purpose: "PROJECT_SIGNING",
      credentialType: "HMAC_SECRET",
      environment: "production",
      plaintext: "signing-secret-123456"
    });

    expect(created.version).toBe(1);
    expect(created.status).toBe("ACTIVE");
    expect(created.maskedSuffix).toBe("3456");
    expect(created.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "CREDENTIAL_CREATED", organizationId: "org-1" })
      })
    );
  });

  it("rotates credentials and leaves the previous version in grace", async () => {
    const previous = {
      id: "cred-1",
      organizationId: "org-1",
      familyId: "family-1",
      projectId: "project-1",
      connectionId: null,
      integrationId: null,
      purpose: "PROJECT_SIGNING",
      credentialType: "HMAC_SECRET",
      environment: "production",
      version: 1,
      status: "ACTIVE"
    };

    managedFindFirst
      .mockResolvedValueOnce(previous)
      .mockResolvedValueOnce(previous);
    managedFindMany.mockResolvedValue([previous]);
    managedCreate.mockImplementation(async ({ data }) => ({
      ...data,
      id: "cred-2",
      createdAt: new Date("2026-07-19T11:00:00.000Z")
    }));
    managedUpdateMany.mockResolvedValue({ count: 0 });

    const created = await rotateCredential({
      organizationId: "org-1",
      familyId: "family-1",
      plaintext: "signing-secret-abcdef",
      gracePeriodMs: 60_000
    });

    expect(created.version).toBe(2);
    expect(managedUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cred-1" },
        data: expect.objectContaining({ status: "GRACE" })
      })
    );
  });

  it("revokes all active family versions", async () => {
    managedUpdateMany.mockResolvedValue({ count: 2 });

    const count = await revokeCredentialFamily({
      organizationId: "org-1",
      familyId: "family-1",
      reason: "compromised"
    });

    expect(count).toBe(2);
    expect(managedUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ familyId: "family-1", organizationId: "org-1" })
      })
    );
  });

  it("resolves ACTIVE and unexpired GRACE secrets with ownership checks", async () => {
    const encrypted = await import("../../lib/secret-crypto").then(({ encryptSecretVersioned }) =>
      encryptSecretVersioned("resolved-secret-9999", "org-1:PROJECT_SIGNING:family-1:2")
    );

    managedFindMany.mockResolvedValue([
      {
        id: "cred-2",
        organizationId: "org-1",
        familyId: "family-1",
        projectId: "project-1",
        connectionId: null,
        purpose: "PROJECT_SIGNING",
        version: 2,
        status: "ACTIVE",
        environment: "production",
        expiresAt: null,
        graceExpiresAt: null,
        fingerprint: "abc",
        ...encrypted
      }
    ]);

    const resolved = await resolveActiveSecrets({
      organizationId: "org-1",
      familyId: "family-1",
      projectId: "project-1",
      environment: "production"
    });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.plaintext).toBe("resolved-secret-9999");
  });

  it("returns metadata without secret material", () => {
    const dto = toCredentialMetadataDto({
      id: "cred-1",
      organizationId: "org-1",
      projectId: "project-1",
      connectionId: null,
      integrationId: null,
      familyId: "family-1",
      purpose: "PROJECT_SIGNING",
      credentialType: "HMAC_SECRET",
      environment: "production",
      version: 1,
      keyVersion: "v1",
      ciphertext: "cipher",
      iv: "iv",
      authTag: "tag",
      maskedSuffix: "1234",
      fingerprint: "fp",
      status: "ACTIVE",
      activatedAt: new Date("2026-07-19T10:00:00.000Z"),
      expiresAt: null,
      graceExpiresAt: null,
      revokedAt: null,
      revokeReason: null,
      createdBy: null,
      rotatedFromId: null,
      lastUsedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      createdAt: new Date("2026-07-19T10:00:00.000Z"),
      updatedAt: new Date("2026-07-19T10:00:00.000Z")
    });

    expect(dto).toMatchObject({
      configured: true,
      purpose: "PROJECT_SIGNING",
      maskedSuffix: "1234",
      keyVersion: "v1"
    });
    expect(JSON.stringify(dto)).not.toContain("cipher");
    expect(JSON.stringify(dto)).not.toContain("tag");
  });
});
