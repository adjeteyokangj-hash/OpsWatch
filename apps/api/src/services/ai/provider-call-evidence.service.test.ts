import { describe, expect, it } from "vitest";
import { providerRuntimeEvidence } from "./provider-call-evidence.service";
describe("provider runtime evidence", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  it("accepts a fresh successful call as runtime evidence", () => {
    expect(providerRuntimeEvidence({ createdAt: new Date(now.getTime() - 1000), metadataJson: { state: "SUCCEEDED" } }, now)).toMatchObject({ reachable: true, state: "SUCCEEDED" });
  });
  it("does not convert missing, stale or future calls into current reachability", () => {
    expect(providerRuntimeEvidence(null, now).reachable).toBe(false);
    for (const offset of [-7_200_000, 1000]) expect(providerRuntimeEvidence({ createdAt: new Date(now.getTime() + offset), metadataJson: { state: "SUCCEEDED" } }, now)).toMatchObject({ reachable: false, state: "UNKNOWN" });
  });
  it("retains fresh failure state without disabling rules-based diagnosis", () => {
    expect(providerRuntimeEvidence({ createdAt: now, metadataJson: { state: "UNAVAILABLE" } }, now)).toMatchObject({ reachable: false, state: "UNAVAILABLE" });
  });
});
