import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEventFindMany = vi.fn();
const mockFindingFindFirst = vi.fn();
const mockFindingCreate = vi.fn();
const mockFindingUpdate = vi.fn();
const mockOccurrenceCreate = vi.fn();
const mockRuleFindMany = vi.fn();
const mockRuleFindFirst = vi.fn();
const mockRuleCreate = vi.fn();

vi.mock("../../lib/prisma", () => ({
  prisma: {
    securityEvent: { findMany: (...args: unknown[]) => mockEventFindMany(...args) },
    securityFinding: {
      findFirst: (...args: unknown[]) => mockFindingFindFirst(...args),
      create: (...args: unknown[]) => mockFindingCreate(...args),
      update: (...args: unknown[]) => mockFindingUpdate(...args)
    },
    securityFindingOccurrence: {
      create: (...args: unknown[]) => mockOccurrenceCreate(...args)
    },
    securityDetectionRule: {
      findMany: (...args: unknown[]) => mockRuleFindMany(...args),
      findFirst: (...args: unknown[]) => mockRuleFindFirst(...args),
      create: (...args: unknown[]) => mockRuleCreate(...args)
    }
  }
}));

import { evaluateSecurityDetections } from "./security-detection.service";
import { findingFingerprint } from "./security-detection-rules";

describe("security detection", () => {
  beforeEach(() => {
    mockEventFindMany.mockReset();
    mockFindingFindFirst.mockReset();
    mockFindingCreate.mockReset();
    mockFindingUpdate.mockReset();
    mockOccurrenceCreate.mockReset();
    mockRuleFindMany.mockReset();
    mockRuleFindFirst.mockReset();
    mockRuleCreate.mockReset();
    mockRuleFindMany.mockResolvedValue([]);
    mockRuleFindFirst.mockResolvedValue(null);
    mockRuleCreate.mockResolvedValue({});
    mockFindingFindFirst.mockResolvedValue(null);
    mockFindingCreate.mockImplementation(async ({ data }: { data: { id: string } }) => data);
    mockOccurrenceCreate.mockResolvedValue({});
  });

  it("creates a failed-login burst finding when threshold is exceeded", async () => {
    const now = Date.now();
    mockEventFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `evt-${index}`,
        eventType: "LOGIN_FAILED",
        timestamp: new Date(now - index * 1000),
        accountIdentifierHash: "acct-1",
        sourceIpTruncated: "203.0.113.0",
        entityId: null,
        relationshipId: null,
        environment: "production",
        projectId: "proj-1",
        payloadJson: {},
        correlationId: null,
        severity: "HIGH"
      }))
    );

    const result = await evaluateSecurityDetections({ organizationId: "org-1", projectId: "proj-1" });
    expect(result.findingsCreatedOrUpdated).toBeGreaterThan(0);
    expect(mockFindingCreate).toHaveBeenCalled();
    const created = mockFindingCreate.mock.calls.find((call) =>
      call[0].data.ruleKey === "identity.failed_login_burst"
    );
    expect(created).toBeTruthy();
    expect(created[0].data.occurrenceCount).toBeGreaterThanOrEqual(5);
    expect(created[0].data.ruleName).toBe("Failed login burst");
  });

  it("groups with deterministic fingerprints", () => {
    const a = findingFingerprint({
      ruleKey: "identity.failed_login_burst",
      organizationId: "org-1",
      projectId: "proj-1",
      environment: "production",
      entityKey: "acct:1"
    });
    const b = findingFingerprint({
      ruleKey: "identity.failed_login_burst",
      organizationId: "org-1",
      projectId: "proj-1",
      environment: "production",
      entityKey: "acct:1"
    });
    expect(a).toBe(b);
  });

  it("does not reopen suppressed findings still within suppression window", async () => {
    const now = Date.now();
    mockEventFindMany.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: `evt-${index}`,
        eventType: "LOGIN_FAILED",
        timestamp: new Date(now - index * 1000),
        accountIdentifierHash: "acct-1",
        sourceIpTruncated: "203.0.113.0",
        entityId: null,
        relationshipId: null,
        environment: "production",
        projectId: "proj-1",
        payloadJson: {},
        correlationId: null,
        severity: "HIGH"
      }))
    );
    mockFindingFindFirst.mockResolvedValue({
      id: "finding-1",
      state: "SUPPRESSED",
      suppressedUntil: new Date(now + 60_000),
      acceptedRiskUntil: null,
      occurrenceCount: 5,
      confidence: 0.7,
      lastSeenAt: new Date(now - 10_000)
    });

    const result = await evaluateSecurityDetections({ organizationId: "org-1" });
    expect(result.findingsCreatedOrUpdated).toBeGreaterThan(0);
    expect(mockFindingUpdate).not.toHaveBeenCalled();
  });
});
