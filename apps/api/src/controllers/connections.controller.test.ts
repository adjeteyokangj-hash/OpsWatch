import { describe, expect, it, vi } from "vitest";

const { findFirst, findMany, update } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn()
}));
vi.mock("../lib/prisma", () => ({ prisma: { connection: { findFirst, findMany, update } } }));

import { listConnections, recordConnectionValidation } from "./connections.controller";

describe("connections controller organization scope", () => {
  it("always constrains list queries to the authenticated organization", async () => {
    findMany.mockResolvedValueOnce([]);
    const json = vi.fn();
    await listConnections(
      { user: { organizationId: "org-a" }, query: { projectId: "project-a" } } as any,
      { json } as any
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-a", projectId: "project-a" }
    }));
    expect(json).toHaveBeenCalledWith([]);
  });

  it("rejects requests without an organization claim", async () => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    await listConnections({ user: undefined, query: {} } as any, { status, json } as any);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: "Organization required" });
  });
});

describe("connection validation", () => {
  it("requires an explicit boolean validation result", async () => {
    findFirst.mockResolvedValueOnce({ id: "connection-a" });
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();

    await recordConnectionValidation(
      { user: { organizationId: "org-a" }, params: { connectionId: "connection-a" }, body: { succeeded: "false" } } as any,
      { status, json } as any
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: "succeeded must be a boolean" });
    expect(update).not.toHaveBeenCalled();
  });
});
