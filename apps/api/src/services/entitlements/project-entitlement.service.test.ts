import { afterEach, describe, expect, it, vi } from "vitest";
import { ENTITLEMENT_KEYS } from "./entitlement-keys";

/**
 * Application-scoped entitlement isolation: two applications in one organisation
 * resolve limits from their OWN ProjectBilling.planCode, and usage is counted for
 * that project only. Changing one application never affects another.
 */

const { mockProjectBillingFindUnique, mockPlanFindUnique, mockCheckCount, mockSloCount, mockChannelCount } =
  vi.hoisted(() => ({
    mockProjectBillingFindUnique: vi.fn(),
    mockPlanFindUnique: vi.fn(),
    mockCheckCount: vi.fn(),
    mockSloCount: vi.fn(),
    mockChannelCount: vi.fn()
  }));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    projectBilling: { findUnique: mockProjectBillingFindUnique },
    plan: { findUnique: mockPlanFindUnique },
    check: { count: mockCheckCount },
    sLODefinition: { count: mockSloCount },
    notificationChannel: { count: mockChannelCount }
  }
}));

import {
  getProjectEntitlements,
  countProjectUsage,
  assertProjectWithinLimit
} from "./project-entitlement.service";

const NOBLE = "proj-noble";
const TRUENUMERIS = "proj-true";

const monitorsEntitlement = (limit: number) => [
  { featureKey: ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX, enabled: true, limit, retentionDays: null, configuration: null }
];

const PLANS: Record<string, { name: string; PlanEntitlement: ReturnType<typeof monitorsEntitlement> }> = {
  BUSINESS: { name: "Business", PlanEntitlement: monitorsEntitlement(750) },
  GROWTH: { name: "Growth", PlanEntitlement: monitorsEntitlement(150) }
};

const BILLING: Record<string, { planCode: string; billingStatus: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null }> = {
  [NOBLE]: { planCode: "BUSINESS", billingStatus: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: null },
  [TRUENUMERIS]: { planCode: "GROWTH", billingStatus: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: null }
};

describe("project-scoped entitlements", () => {
  afterEach(() => vi.clearAllMocks());

  const wireResolvers = () => {
    mockProjectBillingFindUnique.mockImplementation(async (args: { where: { projectId: string } }) => BILLING[args.where.projectId] ?? null);
    mockPlanFindUnique.mockImplementation(async (args: { where: { code: string } }) => PLANS[args.where.code] ?? null);
  };

  it("resolves each application's plan limits from its own ProjectBilling.planCode", async () => {
    wireResolvers();
    const noble = await getProjectEntitlements("org-1", NOBLE);
    const truenumeris = await getProjectEntitlements("org-1", TRUENUMERIS);

    expect(noble.planCode).toBe("BUSINESS");
    expect(truenumeris.planCode).toBe("GROWTH");
    expect(noble.entitlements[ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX].limit).toBe(750);
    expect(truenumeris.entitlements[ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX].limit).toBe(150);
  });

  it("counts monitor usage for the selected project only", async () => {
    mockCheckCount.mockImplementation(async (args: { where: { Service: { projectId: string } } }) =>
      args.where.Service.projectId === NOBLE ? 42 : 7
    );

    const nobleUsage = await countProjectUsage(NOBLE, ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX);
    const trueUsage = await countProjectUsage(TRUENUMERIS, ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX);

    expect(nobleUsage).toBe(42);
    expect(trueUsage).toBe(7);
    expect(mockCheckCount).toHaveBeenCalledWith({ where: { isActive: true, Service: { projectId: NOBLE } } });
  });

  it("enforces each application's own monitor limit independently", async () => {
    wireResolvers();
    // TrueNumeris (Growth, limit 150) is at its cap; Noble (Business, 750) has room.
    mockCheckCount.mockImplementation(async (args: { where: { Service: { projectId: string } } }) =>
      args.where.Service.projectId === TRUENUMERIS ? 150 : 10
    );

    await expect(assertProjectWithinLimit("org-1", NOBLE, ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX)).resolves.toBeUndefined();
    await expect(
      assertProjectWithinLimit("org-1", TRUENUMERIS, ENTITLEMENT_KEYS.MONITORING_MONITORS_MAX)
    ).rejects.toMatchObject({ code: expect.stringMatching(/limit/i) });
  });
});
