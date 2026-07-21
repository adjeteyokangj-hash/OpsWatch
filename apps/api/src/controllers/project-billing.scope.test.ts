import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Billing-scope verification for the application-scoped billing endpoints
 * (GET/PATCH /projects/:projectId/billing). These prove:
 *  - two applications in one organisation hold independent ProjectBilling plans;
 *  - updating one application never touches another application's record;
 *  - missing / invalid projectId is rejected (404);
 *  - a project in a different organisation is rejected (404, cross-org isolation);
 *  - writes require the policy:manage permission (403 otherwise).
 *
 * Handlers are invoked directly with fake req/res to keep the test fast and
 * deterministic (no HTTP round-trip).
 */

const { mockProjectFindFirst, mockGetProjectBilling, mockUpdateProjectBilling, mockHasPermission } =
  vi.hoisted(() => ({
    mockProjectFindFirst: vi.fn(),
    mockGetProjectBilling: vi.fn(),
    mockUpdateProjectBilling: vi.fn(),
    mockHasPermission: vi.fn()
  }));

vi.mock("../lib/prisma", () => ({
  prisma: {
    project: { findFirst: mockProjectFindFirst }
  }
}));

vi.mock("../services/project-billing.service", () => ({
  getProjectBilling: mockGetProjectBilling,
  updateProjectBilling: mockUpdateProjectBilling
}));

vi.mock("../auth/permissions", () => ({
  hasPermission: mockHasPermission
}));

import { getProjectBillingHandler, updateProjectBillingHandler } from "./project-billing.controller";

const NOBLE = "11111111-1111-4111-8111-111111111111"; // org-1
const TRUENUMERIS = "22222222-2222-4222-8222-222222222222"; // org-1
const OTHER_ORG_APP = "33333333-3333-4333-8333-333333333333"; // org-2

const PROJECTS: Record<string, { organizationId: string }> = {
  [NOBLE]: { organizationId: "org-1" },
  [TRUENUMERIS]: { organizationId: "org-1" },
  [OTHER_ORG_APP]: { organizationId: "org-2" }
};

const BILLING: Record<string, { plan: string; project: { id: string; name: string } }> = {
  [NOBLE]: { plan: "ENTERPRISE", project: { id: NOBLE, name: "Noble Express" } },
  [TRUENUMERIS]: { plan: "PRO", project: { id: TRUENUMERIS, name: "TrueNumeris" } }
};

type FakeRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => FakeRes;
  json: (payload: unknown) => FakeRes;
};

const makeRes = (): FakeRes => {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    }
  };
  return res;
};

const makeReq = (
  user: { organizationId: string; role: string } | null,
  projectId: string,
  body?: unknown
) => ({
  params: { projectId },
  user: user ? { sub: "user-1", ...user } : undefined,
  body: body ?? {}
});

const orgScopedFindFirst = () =>
  mockProjectFindFirst.mockImplementation(async (args: { where: { id: string; organizationId: string } }) => {
    const record = PROJECTS[args.where.id];
    if (!record || record.organizationId !== args.where.organizationId) return null;
    return { id: args.where.id };
  });

describe("application-scoped billing isolation", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns each application's own plan (independent ProjectBilling records)", async () => {
    orgScopedFindFirst();
    mockGetProjectBilling.mockImplementation(async (projectId: string) => BILLING[projectId] ?? null);

    const nobleRes = makeRes();
    await getProjectBillingHandler(makeReq({ organizationId: "org-1", role: "ADMIN" }, NOBLE) as never, nobleRes as never);

    const trueRes = makeRes();
    await getProjectBillingHandler(
      makeReq({ organizationId: "org-1", role: "ADMIN" }, TRUENUMERIS) as never,
      trueRes as never
    );

    expect(nobleRes.statusCode).toBe(200);
    expect(trueRes.statusCode).toBe(200);
    expect((nobleRes.body as { plan: string }).plan).toBe("ENTERPRISE");
    expect((trueRes.body as { plan: string }).plan).toBe("PRO");
    expect((nobleRes.body as { plan: string }).plan).not.toBe((trueRes.body as { plan: string }).plan);
  });

  it("updates only the targeted application, never a sibling in the same org", async () => {
    orgScopedFindFirst();
    mockHasPermission.mockReturnValue(true);
    mockUpdateProjectBilling.mockResolvedValue(undefined);
    mockGetProjectBilling.mockResolvedValue(BILLING[NOBLE]);

    const res = makeRes();
    await updateProjectBillingHandler(
      makeReq({ organizationId: "org-1", role: "ADMIN" }, NOBLE, { plan: "ENTERPRISE" }) as never,
      res as never
    );

    expect(res.statusCode).toBe(200);
    expect(mockUpdateProjectBilling).toHaveBeenCalledTimes(1);
    const arg = mockUpdateProjectBilling.mock.calls[0]?.[0] as { projectId: string };
    expect(arg.projectId).toBe(NOBLE);
    expect(arg.projectId).not.toBe(TRUENUMERIS);
  });

  it("rejects a missing / unknown projectId with 404", async () => {
    orgScopedFindFirst();
    const res = makeRes();
    await getProjectBillingHandler(
      makeReq({ organizationId: "org-1", role: "ADMIN" }, "99999999-9999-4999-8999-999999999999") as never,
      res as never
    );
    expect(res.statusCode).toBe(404);
    expect(mockGetProjectBilling).not.toHaveBeenCalled();
  });

  it("rejects billing access to a project in another organisation (cross-org isolation)", async () => {
    orgScopedFindFirst();
    mockHasPermission.mockReturnValue(true);

    const readRes = makeRes();
    await getProjectBillingHandler(
      makeReq({ organizationId: "org-1", role: "ADMIN" }, OTHER_ORG_APP) as never,
      readRes as never
    );

    const writeRes = makeRes();
    await updateProjectBillingHandler(
      makeReq({ organizationId: "org-1", role: "ADMIN" }, OTHER_ORG_APP, { plan: "ENTERPRISE" }) as never,
      writeRes as never
    );

    expect(readRes.statusCode).toBe(404);
    expect(writeRes.statusCode).toBe(404);
    expect(mockGetProjectBilling).not.toHaveBeenCalled();
    expect(mockUpdateProjectBilling).not.toHaveBeenCalled();
  });

  it("rejects billing writes without policy:manage permission", async () => {
    orgScopedFindFirst();
    mockHasPermission.mockReturnValue(false);

    const res = makeRes();
    await updateProjectBillingHandler(
      makeReq({ organizationId: "org-1", role: "MEMBER" }, NOBLE, { plan: "PRO" }) as never,
      res as never
    );

    expect(res.statusCode).toBe(403);
    expect(mockUpdateProjectBilling).not.toHaveBeenCalled();
  });
});
