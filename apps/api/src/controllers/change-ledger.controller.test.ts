import { describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("../lib/prisma", () => ({
  prisma: { changeLedgerEntry: { findMany } }
}));

import { listChangeLedger } from "./change-ledger.controller";

describe("change ledger organization isolation", () => {
  it("constrains ledger reads to the authenticated organization", async () => {
    findMany.mockResolvedValueOnce([]);
    const json = vi.fn();
    await listChangeLedger(
      { user: { organizationId: "org-a" }, query: { projectId: "project-a", limit: "10" } } as any,
      { json } as any
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-a", projectId: "project-a" }
    }));
    expect(json).toHaveBeenCalledWith([]);
  });
});
