import { describe, expect, it } from "vitest";
import { toneFromHeartbeatAge } from "./ai-operations-status.service";

describe("toneFromHeartbeatAge", () => {
  const now = new Date("2026-07-20T19:00:00.000Z");

  it("is green under 10 minutes", () => {
    expect(toneFromHeartbeatAge(new Date("2026-07-20T18:55:00.000Z"), now)).toBe("green");
  });

  it("is amber between 10 and 20 minutes", () => {
    expect(toneFromHeartbeatAge(new Date("2026-07-20T18:45:00.000Z"), now)).toBe("amber");
  });

  it("is red when missing or stale", () => {
    expect(toneFromHeartbeatAge(null, now)).toBe("red");
    expect(toneFromHeartbeatAge(new Date("2026-07-20T18:30:00.000Z"), now)).toBe("red");
  });
});
