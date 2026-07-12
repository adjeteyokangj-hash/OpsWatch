import { describe, expect, it } from "vitest";
import { deriveParentCookieDomain, resolveSessionCookieDomain } from "./cookie-domain";

describe("cookie domain", () => {
  it("derives parent domain for custom subdomains", () => {
    expect(deriveParentCookieDomain("opswatch.okanggroup.com")).toBe(".okanggroup.com");
    expect(deriveParentCookieDomain("api.opswatch.okanggroup.com")).toBe(".okanggroup.com");
  });

  it("skips localhost and vercel preview hosts", () => {
    expect(deriveParentCookieDomain("localhost")).toBeUndefined();
    expect(deriveParentCookieDomain("ops-watch-web.vercel.app")).toBeUndefined();
  });

  it("prefers explicit OPSWATCH_COOKIE_DOMAIN in production", () => {
    const previous = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.OPSWATCH_WEB_URL = "https://opswatch.okanggroup.com";
    process.env.OPSWATCH_COOKIE_DOMAIN = "okanggroup.com";

    expect(resolveSessionCookieDomain()).toBe(".okanggroup.com");

    process.env = previous;
  });
});
