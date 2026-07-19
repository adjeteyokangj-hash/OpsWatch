import { describe, expect, it, vi } from "vitest";

const { findFirst, findMany, update, create, projectFindFirst, auditCreate } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  projectFindFirst: vi.fn(),
  auditCreate: vi.fn()
}));
vi.mock("../lib/prisma", () => ({
  prisma: {
    connection: { findFirst, findMany, update, create },
    project: { findFirst: projectFindFirst },
    auditLog: { create: auditCreate }
  }
}));

import {
  createConnection,
  listConnections,
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

  it("encrypts write-only credentials and never persists plaintext configuration", async () => {
    process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY = "unit-test-encryption-key";
    projectFindFirst.mockResolvedValue({ id: "project-a" });
    auditCreate.mockResolvedValue({});
    create.mockImplementation(async ({ data }) => ({
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

    const persisted = create.mock.calls[0][0].data;
    expect(JSON.stringify(persisted)).not.toContain("plaintext-api-key");
    expect(persisted.managedSecretCiphertext).toEqual(expect.any(String));
    expect(persisted.installationStatus).toBe("DRAFT");
    expect(json.mock.calls[0][0]).toMatchObject({ secretConfigured: true });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("plaintext-api-key");
    delete process.env.OPSWATCH_SECRETS_ENCRYPTION_KEY;
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
      secretRef: null
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
