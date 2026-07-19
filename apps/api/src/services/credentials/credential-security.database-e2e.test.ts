import { randomUUID } from "crypto";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

config({ path: ".env" });
const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("credential security database lifecycle", () => {
  let prisma: import("@prisma/client").PrismaClient;
  let createCredentialVersion: typeof import("./managed-credential.service").createCredentialVersion;
  let rotateCredential: typeof import("./managed-credential.service").rotateCredential;
  let revokeCredentialFamily: typeof import("./managed-credential.service").revokeCredentialFamily;
  let resolveActiveSecrets: typeof import("./managed-credential.service").resolveActiveSecrets;
  let resolveSigningSecretsForProject: typeof import("./managed-credential.service").resolveSigningSecretsForProject;
  let authorizeApiKey: ((req: any, scopes: string[]) => Promise<boolean>) | null = null;

  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  const projectId = randomUUID();
  let connectionId = "";

  beforeAll(async () => {
    ({ prisma } = await import("../../lib/prisma"));
    ({
      createCredentialVersion,
      rotateCredential,
      revokeCredentialFamily,
      resolveActiveSecrets,
      resolveSigningSecretsForProject
    } = await import("./managed-credential.service"));
    const auth = await import("../../middleware/auth");
    // authorizeApiKey is internal; exercise via requireApiKeyScopes path by direct DB + service checks
    void auth;
    authorizeApiKey = null;

    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "TEST ONLY — credential security",
        slug: `test-cred-sec-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.organization.create({
      data: {
        id: otherOrganizationId,
        name: "TEST ONLY — credential other org",
        slug: `test-cred-other-${otherOrganizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "TEST ONLY — credential project",
        slug: `test-cred-project-${projectId}`,
        clientName: "TEST ONLY",
        environment: "testing",
        apiKey: randomUUID(),
        signingSecret: "legacy-signing-secret-for-compat",
        organizationId,
        updatedAt: new Date()
      }
    });
    connectionId = randomUUID();
    await prisma.connection.create({
      data: {
        id: connectionId,
        organizationId,
        projectId,
        name: "TEST ONLY credential connection",
        type: "API",
        mode: "API",
        environment: "testing",
        authMethod: "BEARER",
        updatedAt: new Date()
      }
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.managedCredential.deleteMany({
      where: { organizationId: { in: [organizationId, otherOrganizationId] } }
    });
    await prisma.connection.deleteMany({ where: { id: connectionId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({
      where: { id: { in: [organizationId, otherOrganizationId] } }
    });
    await prisma.$disconnect();
  });

  it("encrypts, rotates with grace, and revokes without exposing plaintext in metadata", async () => {
    const created = await createCredentialVersion({
      organizationId,
      projectId,
      connectionId,
      purpose: "CONNECTION_AUTH",
      credentialType: "BEARER_TOKEN",
      environment: "testing",
      plaintext: "test-secret-v1-only-once"
    });
    expect(created.version).toBe(1);
    expect(JSON.stringify(created)).not.toContain("test-secret-v1-only-once");

    await prisma.connection.update({
      where: { id: connectionId },
      data: { credentialFamilyId: created.familyId }
    });

    const active = await resolveActiveSecrets({
      organizationId,
      familyId: created.familyId,
      connectionId,
      environment: "testing"
    });
    expect(active.map((row) => row.plaintext)).toEqual(["test-secret-v1-only-once"]);

    const rotated = await rotateCredential({
      organizationId,
      familyId: created.familyId,
      plaintext: "test-secret-v2-rotated",
      gracePeriodMs: 60_000
    });
    expect(rotated.version).toBe(2);

    const withGrace = await resolveActiveSecrets({
      organizationId,
      familyId: created.familyId,
      connectionId
    });
    expect(withGrace.map((row) => row.plaintext).sort()).toEqual([
      "test-secret-v1-only-once",
      "test-secret-v2-rotated"
    ].sort());

    const foreign = await resolveActiveSecrets({
      organizationId: otherOrganizationId,
      familyId: created.familyId
    });
    expect(foreign).toHaveLength(0);

    await revokeCredentialFamily({
      organizationId,
      familyId: created.familyId,
      reason: "test revoke"
    });
    const revoked = await resolveActiveSecrets({
      organizationId,
      familyId: created.familyId
    });
    expect(revoked).toHaveLength(0);

    const audits = await prisma.auditLog.findMany({
      where: { organizationId, entityType: "MANAGED_CREDENTIAL" }
    });
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain("test-secret-v1-only-once");
    expect(serialized).not.toContain("test-secret-v2-rotated");
  }, 60_000);

  it("keeps legacy signing secret verification compatible after managed migration", async () => {
    const signing = await createCredentialVersion({
      organizationId,
      projectId,
      purpose: "PROJECT_SIGNING",
      credentialType: "HMAC_SECRET",
      environment: "testing",
      plaintext: "managed-signing-secret"
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { signingCredentialFamilyId: signing.familyId }
    });

    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const secrets = await resolveSigningSecretsForProject(project);
    const plaintexts = secrets.map((row) => row.plaintext);
    expect(plaintexts).toContain("managed-signing-secret");
    expect(plaintexts).toContain("legacy-signing-secret-for-compat");
  }, 30_000);

  it("rejects expired and revoked OrgApiKeys at auth time", async () => {
    const { sha256 } = await import("../../utils/crypto");
    const expiredKeyId = `ow_${randomUUID().slice(0, 12)}`;
    const revokedKeyId = `ow_${randomUUID().slice(0, 12)}`;
    const secret = "database-e2e-api-key-secret";
    await prisma.orgApiKey.createMany({
      data: [
        {
          id: randomUUID(),
          organizationId,
          projectId,
          name: "TEST expired key",
          keyId: expiredKeyId,
          secretHash: sha256(secret),
          scopes: ["events:write"],
          environment: "test",
          expiresAt: new Date(Date.now() - 60_000)
        },
        {
          id: randomUUID(),
          organizationId,
          projectId,
          name: "TEST revoked key",
          keyId: revokedKeyId,
          secretHash: sha256(secret),
          scopes: ["events:write"],
          environment: "test",
          revokedAt: new Date()
        }
      ]
    });

    const { requireApiKeyScopes } = await import("../../middleware/auth");
    const expiredMw = requireApiKeyScopes(["events:write"]);
    const revokedMw = requireApiKeyScopes(["events:write"]);

    const expiredStatus = await new Promise<number>((resolve) => {
      const res = {
        status(code: number) {
          resolve(code);
          return this;
        },
        json() {
          return this;
        }
      };
      void expiredMw(
        { header: (name: string) => (name === "x-api-key" ? `${expiredKeyId}.${secret}` : undefined) } as any,
        res as any,
        () => resolve(200)
      );
    });
    expect(expiredStatus).toBe(401);

    const revokedStatus = await new Promise<number>((resolve) => {
      const res = {
        status(code: number) {
          resolve(code);
          return this;
        },
        json() {
          return this;
        }
      };
      void revokedMw(
        { header: (name: string) => (name === "x-api-key" ? `${revokedKeyId}.${secret}` : undefined) } as any,
        res as any,
        () => resolve(200)
      );
    });
    expect(revokedStatus).toBe(401);

    await prisma.orgApiKey.deleteMany({
      where: { keyId: { in: [expiredKeyId, revokedKeyId] } }
    });
  }, 30_000);
});
