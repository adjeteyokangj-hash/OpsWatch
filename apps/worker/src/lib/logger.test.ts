import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "./logger";

describe("worker logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes info messages with the worker prefix", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.info("heartbeat", { ok: true });

    expect(logSpy).toHaveBeenCalledWith("[opswatch-worker]", "heartbeat", { ok: true });
  });
});
