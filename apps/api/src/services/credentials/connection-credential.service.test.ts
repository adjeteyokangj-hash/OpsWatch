import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  managedFindFirst,
  managedFindMany,
  managedCreate,
  managedUpdate,
  managedUpdateMany,
  transaction,
  auditCreate
} = vi.hoisted(() => ({
  managedFindFirst: vi.fn(),
  managedFindMany: vi.fn(),
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
      create: managedCreate,
      update: managedUpdate,
      updateMany: managedUpdateMany
    },
    auditLog: { create: auditCreate },
    $transaction: transaction
  }
}));

import { encryptSecretVersioned } from "../../lib/secret-crypto";
import {
  computeCredentialDisplayStatus,
  resolveConnectionSecrets,
  sanitizeConnectionError,
  toConnectionCredentialDto,
  upsertConnectionCredential
} from "./connection-credential.service";
import { toCredentialMetadataDto } from "./managed-credential.service";

describe("connection-credential.service", () => {
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

  it("creates managed family and syncs legacy ciphertext on connection create", async () => {
    managedFindFirst.mockResolvedValue(null);
    managedFindMany.mockResolvedValue([]);
    managedCreate.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date("2026-07-19T10:00:00.000Z")
    }));

    const result = await upsertConnectionCredential({
      organizationId: "org-1",
      connectionId: "connection-1",
      projectId: "project-1",
      environment: "production",
      authMethod: "BEARER",
      plaintext: "super-secret-token-1234"
    });

    expect(result.familyId).toEqual(expect.any(String));
    expect(result.legacyEncrypted.ciphertext).toEqual(expect.any(String));
    expect(JSON.stringify(result.legacyEncrypted)).not.toContain("super-secret-token-1234");
  });

  it("returns DTO metadata without secret material", () => {
    const dto = toConnectionCredentialDto(
      {
        organizationId: "org-1",
        credentialFamilyId: "family-1",
        secretRef: "env://SHOULD_NOT_LEAK",
        managedSecretCiphertext: "cipher",
        managedSecretIv: "iv",
        managedSecretAuthTag: "tag",
        authMethod: "BEARER",
        environment: "production",
        health: "HEALTHY"
      },
      toCredentialMetadataDto({
        id: "cred-1",
        organizationId: "org-1",
        projectId: "project-1",
        connectionId: "connection-1",
        integrationId: null,
        familyId: "family-1",
        purpose: "CONNECTION_AUTH",
        credentialType: "BEARER_TOKEN",
        environment: "production",
        version: 2,
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
      })
    );

    expect(dto.secretConfigured).toBe(true);
    expect(dto.hasSecretReference).toBe(true);
    expect(dto.credentialVersion).toBe(2);
    expect(dto.credentialStatus).toBe("ACTIVE");
    expect(JSON.stringify(dto)).not.toContain("cipher");
    expect(JSON.stringify(dto)).not.toContain("env://SHOULD_NOT_LEAK");
  });

  it("resolves ACTIVE managed secrets and rejects revoked rows", async () => {
    const encrypted = encryptSecretVersioned("managed-token-9999", "org-1:CONNECTION_AUTH:family-1:1");
    managedFindMany.mockResolvedValue([
      {
        id: "cred-revoked",
        organizationId: "org-1",
        familyId: "family-1",
        projectId: "project-1",
        connectionId: "connection-1",
        purpose: "CONNECTION_AUTH",
        version: 1,
        status: "REVOKED",
        environment: "production",
        expiresAt: null,
        graceExpiresAt: null,
        fingerprint: "fp",
        ...encrypted
      }
    ]);

    const resolved = await resolveConnectionSecrets({
      organizationId: "org-1",
      credentialFamilyId: "family-1",
      id: "connection-1",
      projectId: "project-1",
      environment: "production",
      secretRef: null,
      managedSecretCiphertext: null,
      managedSecretIv: null,
      managedSecretAuthTag: null
    });

    expect(resolved).toHaveLength(0);
  });

  it("does not fall back to legacy ciphertext when a managed family exists but is empty", async () => {
    managedFindMany.mockResolvedValue([]);
    const resolved = await resolveConnectionSecrets({
      organizationId: "org-1",
      credentialFamilyId: "family-1",
      id: "connection-1",
      projectId: "project-1",
      environment: "production",
      secretRef: "env://SHOULD_NOT_USE",
      managedSecretCiphertext: "legacy-cipher",
      managedSecretIv: "legacy-iv",
      managedSecretAuthTag: "legacy-tag"
    });
    expect(resolved).toEqual([]);
  });

  it("sanitizes probe errors that echo Authorization headers or secrets", () => {
    const sanitized = sanitizeConnectionError(
      "Request failed Authorization: Bearer leaked-secret-value",
      ["leaked-secret-value"]
    );
    expect(sanitized).toContain("[redacted]");
    expect(sanitized).not.toContain("leaked-secret-value");
  });

  it("marks credentials expiring within 14 days as Expiring soon", () => {
    const status = computeCredentialDisplayStatus(
      {
        configured: true,
        purpose: "CONNECTION_AUTH",
        type: "BEARER_TOKEN",
        environment: "production",
        version: 1,
        status: "ACTIVE",
        createdAt: new Date(),
        activatedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        graceExpiresAt: null,
        lastUsedAt: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        maskedSuffix: "1234",
        keyVersion: "v1"
      },
      { health: "HEALTHY" }
    );
    expect(status).toBe("Expiring soon");
  });
});
