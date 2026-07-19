import { describe, expect, it } from "vitest";
import {
  isDisallowedNetworkAddress,
  parseSafeExternalHttpUrl
} from "./outbound-url-safety";

describe("outbound URL safety", () => {
  it("normalizes a public HTTPS URL", () => {
    expect(parseSafeExternalHttpUrl(" https://Example.com/health#fragment ", { requireHttps: true }).toString())
      .toBe("https://example.com/health");
  });

  it.each([
    "http://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal",
    "https://service.internal",
    "https://[::1]"
  ])("rejects local, private, and metadata target %s", (target) => {
    expect(() => parseSafeExternalHttpUrl(target)).toThrow(/not allowed/);
  });

  it("rejects credentials and secret-looking query parameters", () => {
    expect(() => parseSafeExternalHttpUrl("https://user:pass@example.com")).toThrow(/usernames or passwords/);
    expect(() => parseSafeExternalHttpUrl("https://example.com?api_key=secret")).toThrow(/secure connection/);
  });

  it("recognizes private and special-use resolved addresses", () => {
    expect(isDisallowedNetworkAddress("192.168.1.2")).toBe(true);
    expect(isDisallowedNetworkAddress("100.64.0.2")).toBe(true);
    expect(isDisallowedNetworkAddress("fc00::1")).toBe(true);
    expect(isDisallowedNetworkAddress("8.8.8.8")).toBe(false);
  });
});
