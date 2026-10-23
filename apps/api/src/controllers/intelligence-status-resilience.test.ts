import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthRequest } from "../middleware/auth";
import type { Response } from "express";
const mocks = vi.hoisted(() => ({ capability: vi.fn(), worker: vi.fn(), project: vi.fn() }));
vi.mock("../services/intelligence/ai-operations-status.service", () => ({ buildAiOperationsStatus: mocks.capability }));
vi.mock("../services/worker-tick/worker-runtime-status.service", () => ({ buildWorkerRuntimeStatus: mocks.worker }));
vi.mock("../lib/prisma", () => ({ prisma: { project: { findFirst: mocks.project } } }));
import { getAiOperationsStatusHandler } from "./intelligence.controller";
import { unavailableOperationsStatus } from "../services/intelligence/partial-operations-status";
beforeEach(() => vi.clearAllMocks());
async function call(projectId?: string) {
  const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res);
  await getAiOperationsStatusHandler({ user: { role: "ADMIN", organizationId: "tenant-a" }, query: { projectId } } as unknown as AuthRequest, res as unknown as Response);
  return res;
}
describe("independent AI status evidence", () => {
  it("preserves capabilities when worker evidence is unavailable", async () => {
    const status = unavailableOperationsStatus(); status.capabilities = [{ id: "learning_engine", label: "Learning", tone: "green", summary: "Evidence present", lastEvidenceAt: null, evidence: {} }];
    mocks.capability.mockResolvedValue(status); mocks.worker.mockRejectedValue(new Error("database password secret"));
    const res = await call(); const payload = res.json.mock.calls[0][0];
    expect(payload.partial).toBe(true); expect(payload.capabilities.some((row: { id: string }) => row.id === "learning_engine")).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("password"); expect(res.status).not.toHaveBeenCalledWith(503);
  });
  it("preserves worker health when capability queries fail", async () => {
    mocks.capability.mockRejectedValue(new Error("failed")); mocks.worker.mockResolvedValue({ blocked: [], capability: { id: "worker_heartbeat", tone: "green", summary: "Worker healthy", evidence: {}, lastEvidenceAt: null } });
    const res = await call(); const payload = res.json.mock.calls[0][0];
    expect(payload.capabilities.some((row: { id: string; tone: string }) => row.id === "worker_heartbeat" && row.tone === "green")).toBe(true);
    expect(payload.overall.modeLabel).toContain("unavailable");
  });
  it("does not perform runtime queries for another tenant's project", async () => {
    mocks.project.mockResolvedValue(null); const res = await call("foreign");
    expect(res.status).toHaveBeenCalledWith(404); expect(mocks.capability).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
  });
});
