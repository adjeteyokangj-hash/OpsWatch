import { describe, expect, it, vi } from "vitest";

const {
  findFirst,
  findMany,
  update,
  create,
  projectFindFirst,
  auditCreate,
  upsertConnectionCredential,
  fetchActiveCredentialMetadata,
  transaction
} = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  projectFindFirst: vi.fn(),
  auditCreate: vi.fn(),
  upsertConnectionCredential: vi.fn(),
  fetchActiveCredentialMetadata: vi.fn(),
  transaction: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    connection: { findFirst, findMany, update, create },
    project: { findFirst: projectFindFirst },
    auditLog: { create: auditCreate },
    $transaction: transaction
  }
}));

vi.mock("../services/credentials/connection-credential.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/credentials/connection-credential.service")>();
  return {
    ...actual,
    upsertConnectionCredential,
    fetchActiveCredentialMetadata,
    fetchActiveCredentialMetadataBatch: vi.fn().mockResolvedValue(new Map())
  };
});

import {
  createConnection,
  listConnections,
  patchConnection,
  recordConnectionValidation,
  rotateConnectionCredential
} from "./connections.controller";

describe("connections controller organization scope", () => {
  it("always constrains list queries to the authenticated organization", async () => {
    findMany.mockResolvedValueOnce([]);
    const json = vi.fn();
    await listConnections(
      { user: { organizationId: "org-a" }, query: { projectId: "project-a" } } as any,
      { json } as any
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-a", projectId: "project-a" }
    }));
    expect(json).toHaveBeenCalledWith([]);
  });

  it("rejects requests without an organization claim", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await listConnections({ user: undefined, query: {} } as any, { status, json } as any);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Organization required" });
  });
});

describe("connection validation", () => {
  it("prevents spoofed client validation results", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await recordConnectionValidation(
      { user: { organizationId: "org-a" }, params: { connectionId: "connection-a" }, body: { succeeded: "false" } } as any,
      { status, json } as any
    );

    expect(status).toHaveBeenCalledWith(410);
    expect(json).toHaveBeenCalledWith({
      error: "Client-reported validation is deprecated; use the server-side test endpoint"
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("encrypts write-only credentials into managed family and never returns plaintext", async () => {
    process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY = "unit-test-encryption-key";
    projectFindFirst.mockResolvedValue({ id: "project-a" });
    auditCreate.mockResolvedValue({});
    upsertConnectionCredential.mockResolvedValue({
      familyId: "family-a",
      legacyEncrypted: { ciphertext: "cipher", iv: "iv", authTag: "tag" }
    });
    fetchActiveCredentialMetadata.mockResolvedValue({
      configured: true,
      purpose: "CONNECTION_AUTH",
      type: "BEARER_TOKEN",
      environment: "production",
      version: 1,
      status: "ACTIVE",
      createdAt: new Date(),
      activatedAt: new Date(),
      expiresAt: null,
      graceExpiresAt: null,
      lastUsedAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      maskedSuffix: "y-key",
      keyVersion: "v1"
    });
    create.mockImplementation(async ({ data }) => ({
      ...data,
      Project: { id: "project-a", name: "Project A" },
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    update.mockImplementation(async ({ data, where }) => ({
      id: where.id,
      organizationId: "org-a",
      name: "TrueNumeris",
      type: "API",
      mode: "API",
      environment: "production",
      authMethod: "BEARER",
      ...data,
      Project: { id: "project-a", name: "Project A" },
      createdAt: new Date(),
      updatedAt: new Date()
    }));
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await createConnection({
      user: { id: "user-a", organizationId: "org-a" },
      body: {
        applicationId: "project-a",
        name: "TrueNumeris",
        connectorType: "TrueNumeris",
        authSecret: "plaintext-api-key"
      }
    } as any, { status, json } as any);

    expect(upsertConnectionCredential).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-a",
      plaintext: "plaintext-api-key"
    }));
    const created = create.mock.calls[0][0].data;
    expect(JSON.stringify(created)).not.toContain("plaintext-api-key");
    expect(created.credentialFamilyId).toBeUndefined();
    const persisted = update.mock.calls[0][0].data;
    expect(persisted.credentialFamilyId).toBe("family-a");
    expect(persisted.managedSecretCiphertext).toBe("cipher");
    expect(json.mock.calls[0][0]).toMatchObject({ secretConfigured: true, credentialVersion: 1 });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("plaintext-api-key");
    delete process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY;
  });

  it("preserves existing credentials when authSecret is blank on patch", async () => {
    findFirst.mockResolvedValueOnce({
      id: "connection-a",
      organizationId: "org-a",
      name: "API",
      type: "API",
      mode: "API",
      environment: "production",
      authMethod: "BEARER",
      projectId: "project-a",
      capabilitiesJson: ["api_probe"],
      configurationJson: { endpoint: "https://example.test/health", method: "GET", timeoutMs: 1000 },
      secretRef: null,
      credentialFamilyId: "family-a",
      managedSecretCiphertext: "cipher",
      managedSecretIv: "iv",
      managedSecretAuthTag: "tag",
      linkedCheckId: null
    });
    fetchActiveCredentialMetadata.mockResolvedValue(null);
    projectFindFirst.mockResolvedValue({ id: "project-a" });
    auditCreate.mockResolvedValue({});
    transaction.mockImplementation(async (callback: any) =>
      callback({
        check: { updateMany: vi.fn() },
        connection: {
          update: vi.fn().mockResolvedValue({
            id: "connection-a",
            organizationId: "org-a",
            name: "Renamed API",
            type: "API",
            mode: "API",
            environment: "production",
            authMethod: "BEARER",
            capabilitiesJson: ["api_probe"],
            configurationJson: { endpoint: "https://example.test/health", method: "GET", timeoutMs: 1000 },
            credentialFamilyId: "family-a",
            health: "HEALTHY",
            createdAt: new Date(),
            updatedAt: new Date(),
            Project: null
          })
        }
      })
    );
    const json = vi.fn();
    await patchConnection({
      user: { id: "user-a", organizationId: "org-a" },
      params: { connectionId: "connection-a" },
      body: { name: "Renamed API", authSecret: "" }
    } as any, { json } as any);

    expect(upsertConnectionCredential).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalled();
  });

  it("does not swap a rotated credential when its real probe fails", async () => {
    findFirst.mockResolvedValueOnce({
      id: "connection-a",
      organizationId: "org-a",
      projectId: "project-a",
      name: "API",
      mode: "API",
      authMethod: "BEARER",
      configurationJson: { endpoint: "https://example.test/health" },
      secretRef: null,
      credentialFamilyId: null
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await rotateConnectionCredential({
      user: { id: "admin-a", organizationId: "org-a" },
      params: { connectionId: "connection-a" },
      body: { authSecret: "replacement-secret" }
    } as any, { status, json } as any);
    expect(status).toHaveBeenCalledWith(422);
    expect(update).not.toHaveBeenCalled();
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("replacement-secret");
    vi.unstubAllGlobals();
  });
});
