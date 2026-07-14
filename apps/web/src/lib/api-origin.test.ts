import { afterEach, describe, expect, it } from "vitest";
import { CLIENT_API_BASE_URL, resolveOpswatchApiOrigin, shouldUseEmbeddedOpswatchApi } from "./api-origin";

describe("api-origin", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("prefers OPSWATCH_API_ORIGIN", () => {
    process.env.OPSWATCH_API_ORIGIN = "https://api.example.com/";
    process.env.NEXT_PUBLIC_OPSWATCH_API_URL = "https://legacy.example.com/api";
    expect(resolveOpswatchApiOrigin()).toBe("https://api.example.com");
  });

  it("falls back to OPSWATCH_API_URL without /api suffix", () => {
    delete process.env.OPSWATCH_API_ORIGIN;
    process.env.OPSWATCH_API_URL = "https://api.example.com/api";
    expect(resolveOpswatchApiOrigin()).toBe("https://api.example.com");
  });

  it("derives origin from legacy NEXT_PUBLIC_OPSWATCH_API_URL", () => {
    delete process.env.OPSWATCH_API_ORIGIN;
    delete process.env.OPSWATCH_API_URL;
    process.env.NEXT_PUBLIC_OPSWATCH_API_URL = "https://opswatch-api.vercel.app/api";
    expect(resolveOpswatchApiOrigin()).toBe("https://opswatch-api.vercel.app");
  });

  it("uses localhost in development when unset", () => {
    delete process.env.OPSWATCH_API_ORIGIN;
    delete process.env.OPSWATCH_API_URL;
    delete process.env.NEXT_PUBLIC_OPSWATCH_API_URL;
    process.env.NODE_ENV = "development";
    expect(resolveOpswatchApiOrigin()).toBe("http://127.0.0.1:4000");
  });

  it("throws in production when no upstream is configured", () => {
    delete process.env.OPSWATCH_API_ORIGIN;
    delete process.env.OPSWATCH_API_URL;
    process.env.NEXT_PUBLIC_OPSWATCH_API_URL = "/api";
    process.env.NODE_ENV = "production";
    expect(() => resolveOpswatchApiOrigin()).toThrow(/OPSWATCH_API_ORIGIN/);
  });

  it("keeps browser API calls on same-origin /api", () => {
    expect(CLIENT_API_BASE_URL).toBe("/api");
  });

  it("embeds API on Vercel even when OPSWATCH_API_ORIGIN is set", () => {
    process.env.OPSWATCH_API_ORIGIN = "https://api.example.com";
    process.env.VERCEL = "1";
    delete process.env.OPSWATCH_EMBEDDED_API;
    expect(shouldUseEmbeddedOpswatchApi()).toBe(true);
  });

  it("still proxies for local split-dev when origin is set", () => {
    process.env.OPSWATCH_API_ORIGIN = "http://127.0.0.1:4000";
    delete process.env.VERCEL;
    delete process.env.OPSWATCH_EMBEDDED_API;
    expect(shouldUseEmbeddedOpswatchApi()).toBe(false);
  });

  it("respects OPSWATCH_EMBEDDED_API override", () => {
    process.env.OPSWATCH_API_ORIGIN = "https://api.example.com";
    process.env.VERCEL = "1";
    process.env.OPSWATCH_EMBEDDED_API = "false";
    expect(shouldUseEmbeddedOpswatchApi()).toBe(false);
    process.env.OPSWATCH_EMBEDDED_API = "true";
    expect(shouldUseEmbeddedOpswatchApi()).toBe(true);
  });
});
