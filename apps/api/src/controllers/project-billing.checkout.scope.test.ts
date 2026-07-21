import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Scope + safety checks for the application-scoped checkout/portal endpoints:
 * requires org + policy:manage, rejects cross-organisation projects (404),
 * returns 503 when Stripe is off, validates planCode, and forwards the correct
 * projectId + interval to the application-scoped Stripe service.
 */

const {
  mockProjectFindFirst,
  mockHasPermission,
  mockIsStripeConfigured,
  mockCreateCheckout,
  mockCreatePortal
} = vi.hoisted(() => ({
  mockProjectFindFirst: vi.fn(),
  mockHasPermission: vi.fn(),
  mockIsStripeConfigured: vi.fn(),
  mockCreateCheckout: vi.fn(),
  mockCreatePortal: vi.fn()
}));

vi.mock("../lib/prisma", () => ({ prisma: { project: { findFirst: mockProjectFindFirst } } }));
vi.mock("../auth/permissions", () => ({ hasPermission: mockHasPermission }));
vi.mock("../services/project-billing.service", () => ({
  getProjectBilling: vi.fn(),
  updateProjectBilling: vi.fn()
}));
vi.mock("../services/billing/stripe.service", () => ({ isStripeConfigured: mockIsStripeConfigured }));
vi.mock("../services/billing/project-stripe.service", () => ({
  createProjectCheckoutSession: mockCreateCheckout,
  createProjectBillingPortalSession: mockCreatePortal,
  listProjectInvoices: vi.fn()
}));

import { createProjectCheckoutHandler } from "./project-billing.controller";

const APP = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_APP = "33333333-3333-4333-8333-333333333333";

type FakeRes = { statusCode: number; body: unknown; status: (c: number) => FakeRes; json: (p: unknown) => FakeRes };
const makeRes = (): FakeRes => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) { res.statusCode = c; return res; },
    json(p: unknown) { res.body = p; return res; }
  };
  return res;
};
const makeReq = (user: { organizationId?: string; role?: string } | null, projectId: string, body?: unknown) => ({
  params: { projectId },
  user: user ? { sub: "u1", ...user } : undefined,
  body: body ?? {}
});

const orgScopedFindFirst = () =>
  mockProjectFindFirst.mockImplementation(async (args: { where: { id: string; organizationId: string } }) =>
    args.where.id === APP && args.where.organizationId === "org-1" ? { id: APP } : null
  );

describe("application-scoped checkout endpoint", () => {
  afterEach(() => vi.clearAllMocks());

  it("rejects without policy:manage (403)", async () => {
    mockHasPermission.mockReturnValue(false);
    const res = makeRes();
    await createProjectCheckoutHandler(makeReq({ organizationId: "org-1", role: "MEMBER" }, APP, { planCode: "BUSINESS" }) as never, res as never);
    expect(res.statusCode).toBe(403);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("rejects a project in another organisation (404)", async () => {
    mockHasPermission.mockReturnValue(true);
    orgScopedFindFirst();
    const res = makeRes();
    await createProjectCheckoutHandler(makeReq({ organizationId: "org-1", role: "ADMIN" }, OTHER_ORG_APP, { planCode: "BUSINESS" }) as never, res as never);
    expect(res.statusCode).toBe(404);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("returns 503 when Stripe is not configured", async () => {
    mockHasPermission.mockReturnValue(true);
    orgScopedFindFirst();
    mockIsStripeConfigured.mockResolvedValue(false);
    const res = makeRes();
    await createProjectCheckoutHandler(makeReq({ organizationId: "org-1", role: "ADMIN" }, APP, { planCode: "BUSINESS" }) as never, res as never);
    expect(res.statusCode).toBe(503);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("rejects an invalid planCode (400)", async () => {
    mockHasPermission.mockReturnValue(true);
    orgScopedFindFirst();
    mockIsStripeConfigured.mockResolvedValue(true);
    const res = makeRes();
    await createProjectCheckoutHandler(makeReq({ organizationId: "org-1", role: "ADMIN" }, APP, { planCode: "NOPE" }) as never, res as never);
    expect(res.statusCode).toBe(400);
    expect(mockCreateCheckout).not.toHaveBeenCalled();
  });

  it("forwards the correct projectId + interval to the Stripe service", async () => {
    mockHasPermission.mockReturnValue(true);
    orgScopedFindFirst();
    mockIsStripeConfigured.mockResolvedValue(true);
    mockCreateCheckout.mockResolvedValue({ url: "https://stripe.test/checkout" });
    const res = makeRes();
    await createProjectCheckoutHandler(
      makeReq({ organizationId: "org-1", role: "ADMIN" }, APP, { planCode: "GROWTH", billingInterval: "ANNUAL" }) as never,
      res as never
    );
    expect(res.statusCode).toBe(200);
    expect((res.body as { url: string }).url).toBe("https://stripe.test/checkout");
    expect(mockCreateCheckout).toHaveBeenCalledTimes(1);
    const arg = mockCreateCheckout.mock.calls[0][0];
    expect(arg).toMatchObject({ organizationId: "org-1", projectId: APP, planCode: "GROWTH", interval: "annual" });
  });
});
