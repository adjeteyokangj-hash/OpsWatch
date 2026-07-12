import { describe, expect, it } from "vitest";
import { createExclusiveRunner } from "./exclusive-job";

describe("exclusive-job", () => {
  it("skips overlapping scheduled runs", async () => {
    const run = createExclusiveRunner("test-job");
    let active = 0;
    let maxActive = 0;

    const job = async (): Promise<void> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
    };

    const [first, second] = await Promise.all([run(job), run(job)]);
    expect(first).toBe("ran");
    expect(second).toBe("skipped");
    expect(maxActive).toBe(1);
  });
});
