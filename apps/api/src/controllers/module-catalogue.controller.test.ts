import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ project: vi.fn(), definitions: vi.fn(), transaction: vi.fn() }));
vi.mock("../lib/prisma", () => ({ prisma: { project: { findFirst: mocks.project }, moduleCatalogueDefinition: { findMany: mocks.definitions }, $transaction: mocks.transaction } }));
import { analyseProjectModules, createCustomModule, getProjectModuleCatalogue, reviewProjectModule } from "./module-catalogue.controller";
import type { AuthRequest } from "../middleware/auth";
import type { Response } from "express";

function response() {
  const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
  return res;
}
const req = (role = "ADMIN", body: unknown = {}) => ({ user: { role, organizationId: "tenant-a" }, params: { projectId: "foreign-project", moduleKey: "payments" }, body }) as unknown as AuthRequest;
beforeEach(() => vi.clearAllMocks());
describe("catalogue API authority boundaries", () => {
  it("denies every viewer mutation before looking up project data", async () => {
    for (const handler of [analyseProjectModules, createCustomModule, reviewProjectModule]) {
      const res = response(); await handler(req("VIEWER"), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mocks.project).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("uses tenant and project together and returns 404 for another tenant", async () => {
    mocks.project.mockResolvedValue(null);
    const res = response(); await getProjectModuleCatalogue(req(), res as unknown as Response);
    expect(mocks.project.mock.calls[0][0].where).toEqual({ id: "foreign-project", organizationId: "tenant-a" });
    expect(res.status).toHaveBeenCalledWith(404); expect(mocks.definitions).not.toHaveBeenCalled();
  });
  it("does not let an admin approve a foreign project", async () => {
    mocks.project.mockResolvedValue(null);
    const res = response(); await reviewProjectModule(req("ADMIN", { state: "APPROVED" }), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(404); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rejects attempts to replace a platform key", async () => {
    const res = response(); await createCustomModule(req("ADMIN", { key: "payments", label: "Other payments", description: "Override", category: "CUSTOM", terms: ["pay"] }), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(409); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("redacts database failures", async () => {
    mocks.project.mockRejectedValue(new Error("postgresql://user:secret@internal/database"));
    const res = response(); await getProjectModuleCatalogue(req(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(503); expect(JSON.stringify(res.json.mock.calls)).not.toContain("secret");
  });
});
