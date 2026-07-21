import { afterEach, describe, expect, it } from "vitest";
import { getCsrfToken } from "./auth";

const setRawCookie = (value: string): void => {
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => value
  });
};

describe("getCsrfToken cookie parsing", () => {
  afterEach(() => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      writable: true,
      value: ""
    });
  });

  it("returns the token for a single opswatch_csrf cookie", () => {
    setRawCookie("opswatch_csrf=abc123");
    expect(getCsrfToken()).toBe("abc123");
  });

  it("returns the LAST occurrence when duplicate opswatch_csrf cookies exist", () => {
    // The API parses the Cookie header with last-occurrence-wins semantics; the
    // client must send the same value or every write fails with Invalid CSRF token.
    setRawCookie("opswatch_csrf=stale-first; opswatch_session=s; opswatch_csrf=current-last");
    expect(getCsrfToken()).toBe("current-last");
  });

  it("decodes URL-encoded values and preserves base64url tokens", () => {
    setRawCookie("opswatch_csrf=Ab_cd-EF12");
    expect(getCsrfToken()).toBe("Ab_cd-EF12");
  });

  it("returns null when the CSRF cookie is absent", () => {
    setRawCookie("something_else=1");
    expect(getCsrfToken()).toBeNull();
  });
});
