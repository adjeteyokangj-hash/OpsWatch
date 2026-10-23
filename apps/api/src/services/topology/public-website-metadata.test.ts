import { describe, expect, it, vi } from "vitest";
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup }));
import { resolvePublicWebsiteTarget } from "./public-website-metadata";

describe("website metadata network boundary", () => {
  it("rejects localhost, credentials and non HTTPS", async () => {
    for (const url of ["https://localhost/", "https://user:password@example.com/", "http://example.com/"]) await expect(resolvePublicWebsiteTarget(url)).rejects.toThrow();
  });
  it("rejects mixed public and private DNS answers", async () => {
    lookup.mockResolvedValue([{ address: "8.8.8.8" }, { address: "127.0.0.1" }]);
    await expect(resolvePublicWebsiteTarget("https://example.com")).rejects.toThrow("Private");
  });
  it("pins a public answer for the actual TLS connection", async () => {
    lookup.mockResolvedValue([{ address: "8.8.8.8" }]);
    const result = await resolvePublicWebsiteTarget("https://example.com/path");
    expect(result.address).toBe("8.8.8.8"); expect(result.url.hostname).toBe("example.com");
  });
});
