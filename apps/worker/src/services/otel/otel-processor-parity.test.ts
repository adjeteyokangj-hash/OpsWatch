import { describe, expect, it } from "vitest";
import {
  processOtelFreshness as canonicalProcessOtelFreshness,
  processOtelBatch as canonicalProcessOtelBatch,
  processPendingOtelBatches as canonicalProcessPendingOtelBatches
} from "@opswatch/api/otel-process";
import {
  processOtelBatch as workerProcessOtelBatch,
  processPendingOtelBatches as workerProcessPendingOtelBatches
} from "./otel-batch-processor.service";
import { processOtelFreshness as workerProcessOtelFreshness } from "./otel-freshness.service";

describe("OTEL processor parity", () => {
  it("uses the exact canonical implementation in API and worker paths", () => {
    expect(workerProcessOtelBatch).toBe(canonicalProcessOtelBatch);
    expect(workerProcessPendingOtelBatches).toBe(
      canonicalProcessPendingOtelBatches
    );
    expect(workerProcessOtelFreshness).toBe(canonicalProcessOtelFreshness);
  });
});
