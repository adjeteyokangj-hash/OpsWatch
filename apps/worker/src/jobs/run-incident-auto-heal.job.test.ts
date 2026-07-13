import { afterEach, describe, expect, it, vi } from "vitest";
import { runIncidentAutoHealJob } from "./run-incident-auto-heal.job";

describe("run-incident-auto-heal.job", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WORKER_AUTO_HEAL_ENABLED;
    delete process.env.OPSWATCH_API_URL;
    delete process.env.WORKER_INTERNAL_SECRET;
  });

  it("skips when worker auto-heal is disabled", async () => {
    process.env.WORKER_AUTO_HEAL_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await runIncidentAutoHealJob();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls internal auto-heal endpoint when enabled", async () => {
    process.env.OPSWATCH_API_URL = "http://127.0.0.1:4000/api";
    process.env.WORKER_INTERNAL_SECRET = " test-secret ";

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ scanned: 2, attempted: 1 })
    });
    vi.stubGlobal("fetch", fetchMock);

    await runIncidentAutoHealJob();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:4000/api/internal/auto-heal/run",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-opswatch-worker-secret": "test-secret"
        })
      })
    );
  });

  it("fails fast when worker internal secret is missing", async () => {
    await expect(runIncidentAutoHealJob()).rejects.toThrow("WORKER_INTERNAL_SECRET is not configured");
  });
});
