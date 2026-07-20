/**
 * Phase 8 security database E2E.
 * Enable with RUN_DATABASE_E2E=true after `prisma migrate deploy`.
 */
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { ingestSecurityEvents } from "./security-ingest.service";
import { evaluateSecurityDetections } from "./security-detection.service";
import { correlateThreatSequences } from "./security-correlation.service";
import { createSecurityResponseRun } from "./security-response.service";
import { markFindingFalsePositive, acceptFindingRisk } from "./security-findings-lifecycle.service";
import { pruneSecurityDataForOrg } from "./security-retention.service";

const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("Phase 8 security database E2E", () => {
  const organizationId = randomUUID();
  const projectId = randomUUID();
  let apiKeyId = "";

  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: `Phase8 Security ${organizationId.slice(0, 8)}`,
        slug: `phase8-sec-${organizationId.slice(0, 8)}`,
        updatedAt: new Date()
      }
    });
    await prisma.project.create({
      data: {
        id: projectId,
        name: "Phase8 Security Project",
        slug: `phase8-sec-proj-${projectId.slice(0, 8)}`,
        clientName: "Phase8",
        environment: "production",
        organizationId,
        apiKey: `ow_${randomUUID().replace(/-/g, "")}`,
        signingSecret: randomUUID(),
        updatedAt: new Date()
      }
    });
    const key = await prisma.orgApiKey.create({
      data: {
        id: randomUUID(),
        organizationId,
        name: "phase8-test-key",
        keyId: `k_${randomUUID().slice(0, 8)}`,
        secretHash: randomUUID(),
        scopes: ["security.events:write"],
        environment: "production"
      }
    });
    apiKeyId = key.id;
  }, 60_000);

  afterAll(async () => {
    await prisma.securityFindingOccurrence.deleteMany({ where: { organizationId } });
    await prisma.securityEvidenceLink.deleteMany({ where: { organizationId } });
    await prisma.securityIncidentEvidence.deleteMany({ where: { organizationId } });
    await prisma.securityResponseRun.deleteMany({ where: { organizationId } });
    await prisma.securityFinding.deleteMany({ where: { organizationId } });
    await prisma.threatCorrelationSequence.deleteMany({ where: { organizationId } });
    await prisma.securityEvent.deleteMany({ where: { organizationId } });
    await prisma.securityDetectionRule.deleteMany({ where: { organizationId } });
    await prisma.securityCoverageState.deleteMany({ where: { organizationId } });
    await prisma.securityAssetRisk.deleteMany({ where: { organizationId } });
    await prisma.securityEvidenceAccessAudit.deleteMany({ where: { organizationId } });
    await prisma.orgApiKey.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  }, 60_000);

  it("ingests failed login burst, groups finding, correlates, and verifies key revoke", async () => {
    const now = Date.now();
    const events = Array.from({ length: 6 }, (_, index) => ({
      eventType: "LOGIN_FAILED" as const,
      severity: "HIGH",
      environment: "production",
      projectId,
      accountIdentifier: "user-0@example.com",
      sourceIp: "198.51.100.10",
      idempotencyKey: `burst-${index}-${now}`,
      payload: { reason: "bad_password" },
      timestamp: new Date(now - index * 1000)
    }));

    // Add success + privilege change for correlation
    events.push(
      {
        eventType: "LOGIN_SUCCEEDED" as const,
        severity: "HIGH",
        environment: "production",
        projectId,
        accountIdentifier: "user-0@example.com",
        sourceIp: "198.51.100.10",
        idempotencyKey: `success-${now}`,
        payload: {},
        timestamp: new Date(now + 1000)
      } as any,
      {
        eventType: "ROLE_CHANGED" as const,
        severity: "CRITICAL",
        environment: "production",
        projectId,
        accountIdentifier: "user-0@example.com",
        sourceIp: "198.51.100.10",
        idempotencyKey: `role-${now}`,
        payload: { role: "admin" },
        timestamp: new Date(now + 2000)
      } as any
    );

    const ingest = await ingestSecurityEvents(events, {
      organizationId,
      environmentBinding: "production",
      providerSource: "e2e"
    });
    expect(ingest.accepted).toBeGreaterThanOrEqual(6);

    // Wait briefly for fire-and-forget detection or run explicitly
    await new Promise((resolve) => setTimeout(resolve, 500));
    const detection = await evaluateSecurityDetections({ organizationId, projectId });
    expect(detection.findingsCreatedOrUpdated).toBeGreaterThan(0);

    const finding = await prisma.securityFinding.findFirst({
      where: { organizationId, ruleKey: "identity.failed_login_burst" }
    });
    expect(finding).toBeTruthy();
    expect(finding!.occurrenceCount).toBeGreaterThanOrEqual(5);

    const correlation = await correlateThreatSequences({ organizationId, projectId });
    expect(correlation.sequences.length).toBeGreaterThan(0);

    const response = await createSecurityResponseRun({
      organizationId,
      projectId,
      findingId: finding!.id,
      actionKey: "REVOKE_ORG_API_KEY",
      automationMode: "APPROVAL",
      context: { orgApiKeyId: apiKeyId }
    });
    expect(response.status).toBe("VERIFIED");
    const key = await prisma.orgApiKey.findUnique({ where: { id: apiKeyId } });
    expect(key?.revokedAt).toBeTruthy();

    // Finding must not auto-resolve after containment
    const after = await prisma.securityFinding.findUnique({ where: { id: finding!.id } });
    expect(after?.state).not.toBe("RESOLVED");

    const fp = await markFindingFalsePositive({
      organizationId,
      findingId: finding!.id,
      reason: "controlled e2e fixture"
    });
    expect(fp?.state).toBe("FALSE_POSITIVE");

    // Evidence retained
    const occurrences = await prisma.securityFindingOccurrence.count({
      where: { findingId: finding!.id }
    });
    expect(occurrences).toBeGreaterThan(0);

    const accepted = await acceptFindingRisk({
      organizationId,
      findingId: finding!.id,
      reason: "accepted for e2e",
      until: new Date(Date.now() + 86400000)
    });
    expect(accepted?.state).toBe("ACCEPTED_RISK");

    const pruned = await pruneSecurityDataForOrg(organizationId);
    expect(pruned.preservedLinkedEvents).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
