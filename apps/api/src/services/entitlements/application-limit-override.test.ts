import { beforeEach, describe, expect, it, vi } from "vitest";

const mockProjectCount = vi.fn();
const mockSubscriptionFindUnique = vi.fn();

vi.mock("../../lib/prisma", () => ({
  prisma: {
    project: { count: (...args: unknown[]) => mockProjectCount(...args) },
    user: { count: vi.fn() },
    check: { count: vi.fn() },
    sLODefinition: { count: vi.fn() },
    statusPage: { count: vi.fn() },
    notificationChannel: { count: vi.fn() },
    subscription: {
      findUnique: (...args: unknown[]) => mockSubscriptionFindUnique(...args)
    },
    plan: { findUniqueOrThrow: vi.fn() }
  }
}));

import { assertWithinLimit } from "./entitlement.service";
import { ENTITLEMENT } from "./entitlement-keys";

const pilotSubscription = {
  organizationId: "org-1",
  status: "ACTIVE",
  Plan: {
    code: "PILOT",
    name: "Pilot",
    PlanEntitlement: [
      {
        featureKey: "monitoring.applications.max",
        enabled: true,
        limit: 3,
        retentionDays: null,
        configuration: null
      }
    ]
  }
};

describe("assertWithinLimit platform super admin override", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSubscriptionFindUnique.mockResolvedValue(pilotSubscription);
    mockProjectCount.mockResolvedValue(3);
  });

  it("blocks ordinary users at the Pilot applications.max cap", async () => {
    await expect(
      assertWithinLimit("org-1", ENTITLEMENT.APPLICATIONS_MAX, 1, {
        allowPlatformSuperAdminLimitOverride: true,
        actorEmail: "customer-admin@example.com",
        actorIsPlatformSuperAdmin: false
      })
    ).rejects.toMatchObject({
      code: "ENTITLEMENT_LIMIT_EXCEEDED",
      details: { current: 3, limit: 3 }
    });
    expect(mockProjectCount).toHaveBeenCalled();
  });

  it("lets platform super admins create beyond applications.max", async () => {
    await expect(
      assertWithinLimit("org-1", ENTITLEMENT.APPLICATIONS_MAX, 1, {
        allowPlatformSuperAdminLimitOverride: true,
        actorEmail: "admin@okanggroup.com",
        actorIsPlatformSuperAdmin: true
      })
    ).resolves.toBeUndefined();
    expect(mockProjectCount).not.toHaveBeenCalled();
  });

  it("still honors the allowlist email when the DB flag is unset", async () => {
    await expect(
      assertWithinLimit("org-1", ENTITLEMENT.APPLICATIONS_MAX, 1, {
        allowPlatformSuperAdminLimitOverride: true,
        actorEmail: "admin@okanggroup.com",
        actorIsPlatformSuperAdmin: null
      })
    ).resolves.toBeUndefined();
  });
});
