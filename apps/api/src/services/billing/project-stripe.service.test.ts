import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Application-scoped Stripe billing: checkout attaches a stable application
 * identifier, and webhook sync / invoice handlers update ONLY the matching
 * ProjectBilling row. A webhook for Noble Express never touches TrueNumeris.
 */

const {
  mockProjectBillingFindUnique,
  mockProjectBillingFindFirst,
  mockProjectBillingUpdate,
  mockProjectBillingCreate,
  mockProjectFindUnique,
  mockPlanFindUnique,
  mockPlanFindFirst,
  mockGetStripe,
  mockSeedPlans
} = vi.hoisted(() => ({
  mockProjectBillingFindUnique: vi.fn(),
  mockProjectBillingFindFirst: vi.fn(),
  mockProjectBillingUpdate: vi.fn(),
  mockProjectBillingCreate: vi.fn(),
  mockProjectFindUnique: vi.fn(),
  mockPlanFindUnique: vi.fn(),
  mockPlanFindFirst: vi.fn(),
  mockGetStripe: vi.fn(),
  mockSeedPlans: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    projectBilling: {
      findUnique: mockProjectBillingFindUnique,
      findFirst: mockProjectBillingFindFirst,
      update: mockProjectBillingUpdate,
      create: mockProjectBillingCreate
    },
    project: { findUnique: mockProjectFindUnique },
    plan: { findUnique: mockPlanFindUnique, findFirst: mockPlanFindFirst }
  }
}));

vi.mock("./stripe.service", () => ({
  getStripe: mockGetStripe,
  webBaseUrl: () => "http://localhost:3000",
  StripeWebhookProcessingError: class StripeWebhookProcessingError extends Error {}
}));

vi.mock("../entitlements/subscription.service", () => ({
  seedPlans: mockSeedPlans
}));

import {
  createProjectCheckoutSession,
  syncProjectSubscriptionFromStripe,
  recordProjectInvoicePaid,
  markProjectPaymentFailed
} from "./project-stripe.service";

const NOBLE = "proj-noble";
const PB_NOBLE = "pb-noble";
const PB_TRUE = "pb-true";

const fakeSubscription = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "sub_noble",
    status: "active",
    customer: "cus_noble",
    cancel_at_period_end: false,
    trial_end: null,
    start_date: 1_700_000_000,
    items: { data: [{ price: { id: "price_m", product: "prod_1" }, current_period_start: 1_700_000_000, current_period_end: 1_702_600_000 } ] },
    metadata: { projectBillingId: PB_NOBLE, projectId: NOBLE, planCode: "BUSINESS" },
    ...overrides
  }) as never;

describe("application-scoped Stripe billing", () => {
  afterEach(() => vi.clearAllMocks());

  it("attaches organisation + project + projectBilling metadata to checkout", async () => {
    const sessionsCreate = vi.fn().mockResolvedValue({ url: "https://stripe.test/checkout" });
    mockGetStripe.mockResolvedValue({
      checkout: { sessions: { create: sessionsCreate } },
      customers: { create: vi.fn() },
      billingPortal: { sessions: { create: vi.fn() } }
    });
    mockProjectBillingFindUnique.mockResolvedValue({
      id: PB_NOBLE,
      projectId: NOBLE,
      stripeCustomerId: "cus_noble",
      stripeSubscriptionId: null,
      billingStatus: "ACTIVE"
    });
    mockPlanFindUnique.mockResolvedValue({
      code: "BUSINESS",
      monthlyPrice: 349,
      currency: "GBP",
      stripePriceMonthlyId: "price_m",
      stripePriceAnnualId: "price_a"
    });

    const result = await createProjectCheckoutSession({
      organizationId: "org-1",
      projectId: NOBLE,
      planCode: "BUSINESS",
      interval: "monthly",
      email: "ops@example.com"
    });

    expect(result.url).toBe("https://stripe.test/checkout");
    const arg = sessionsCreate.mock.calls[0][0];
    expect(arg.metadata).toMatchObject({
      organizationId: "org-1",
      projectId: NOBLE,
      projectBillingId: PB_NOBLE,
      planCode: "BUSINESS",
      billingInterval: "MONTHLY"
    });
    expect(arg.subscription_data.metadata).toMatchObject({ projectId: NOBLE, projectBillingId: PB_NOBLE });
    expect(arg.line_items[0].price).toBe("price_m");
  });

  it("syncs a subscription into ONLY the matching ProjectBilling row", async () => {
    mockProjectBillingFindUnique.mockImplementation(async (args: { where: { id?: string; projectId?: string; stripeSubscriptionId?: string } }) => {
      if (args.where.id === PB_NOBLE) return { id: PB_NOBLE, projectId: NOBLE, planCode: "BUSINESS", monthlyPrice: 349, currency: "GBP", billingInterval: "MONTHLY", renewalDate: null };
      return null;
    });
    mockPlanFindFirst.mockResolvedValue({ code: "BUSINESS", monthlyPrice: 349, currency: "GBP", stripePriceMonthlyId: "price_m", stripePriceAnnualId: "price_a" });
    mockProjectBillingUpdate.mockResolvedValue({});

    const handled = await syncProjectSubscriptionFromStripe(fakeSubscription());

    expect(handled).toBe(true);
    expect(mockProjectBillingUpdate).toHaveBeenCalledTimes(1);
    const arg = mockProjectBillingUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: PB_NOBLE });
    expect(arg.data.stripeSubscriptionId).toBe("sub_noble");
    expect(arg.data.planCode).toBe("BUSINESS");
    expect(arg.data.billingStatus).toBe("ACTIVE");
  });

  it("returns false (does not touch ProjectBilling) for a non-application subscription", async () => {
    mockProjectBillingFindUnique.mockResolvedValue(null);
    mockProjectBillingFindFirst.mockResolvedValue(null);

    const handled = await syncProjectSubscriptionFromStripe(
      fakeSubscription({ metadata: {}, id: "sub_org", customer: "cus_org" })
    );

    expect(handled).toBe(false);
    expect(mockProjectBillingUpdate).not.toHaveBeenCalled();
  });

  it("invoice.paid marks only the matching application paid", async () => {
    mockProjectBillingFindUnique.mockImplementation(async (args: { where: { stripeSubscriptionId?: string } }) =>
      args.where.stripeSubscriptionId === "sub_noble"
        ? { id: PB_NOBLE, billingStatus: "PAST_DUE", latestInvoiceId: null }
        : null
    );
    mockProjectBillingUpdate.mockResolvedValue({});

    const handled = await recordProjectInvoicePaid({ id: "in_1", subscription: "sub_noble", customer: "cus_noble" } as never);

    expect(handled).toBe(true);
    const arg = mockProjectBillingUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: PB_NOBLE });
    expect(arg.data.billingStatus).toBe("ACTIVE");
    expect(arg.data.latestInvoiceId).toBe("in_1");
  });

  it("payment failure marks only the matching application past due", async () => {
    mockProjectBillingFindUnique.mockImplementation(async (args: { where: { stripeSubscriptionId?: string } }) =>
      args.where.stripeSubscriptionId === "sub_true" ? { id: PB_TRUE, billingStatus: "ACTIVE" } : null
    );
    mockProjectBillingUpdate.mockResolvedValue({});

    const handled = await markProjectPaymentFailed({ id: "in_2", subscription: "sub_true", customer: "cus_true" } as never);

    expect(handled).toBe(true);
    const arg = mockProjectBillingUpdate.mock.calls[0][0];
    expect(arg.where).toEqual({ id: PB_TRUE });
    expect(arg.data.billingStatus).toBe("PAST_DUE");
  });
});
