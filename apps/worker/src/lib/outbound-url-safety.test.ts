import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));

vi.mock("dns/promises", () => ({ lookup }));

import { resolveSafeOutboundTarget } from "./outbound-url-safety";

describe("worker outbound URL safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  });

  it("returns only a DNS-verified public target", async () => {
    const result = await resolveSafeOutboundTarget("https://example.com/health");
    expect(result.url.toString()).toBe("https://example.com/health");
    expect(result.addresses).toEqual(["8.8.8.8"]);
  });

  it("rejects DNS rebinding to private or metadata addresses", async () => {
    lookup.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
    await expect(resolveSafeOutboundTarget("https://example.com")).rejects.toThrow(/local, private, or metadata/);
  });

  it.each([
    "http://localhost",
    "https://127.0.0.1",
    "https://metadata.google.internal/latest/meta-data",
    "https://user:password@example.com"
  ])("rejects unsafe target %s before DNS", async (target) => {
    await expect(resolveSafeOutboundTarget(target)).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled();
  });
});
