import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveDomain } = vi.hoisted(() => ({ resolveDomain: vi.fn() }));

vi.mock("../config/cookie-domain", () => ({
  resolveSessionCookieDomain: resolveDomain
}));

import { clearSessionCookies, parseCookieHeader } from "./session-cookie";

describe("session cookies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses last occurrence wins when duplicate cookie names exist", () => {
    expect(parseCookieHeader("opswatch_session=old; other=1; opswatch_session=current")).toEqual({
      opswatch_session: "current",
      other: "1"
    });
  });

  it("clears domain-scoped and host-only session, csrf and legacy cookies", () => {
    resolveDomain.mockReturnValue(".okanggroup.com");
    const clearCookie = vi.fn();
    const response = { clearCookie } as never;

    clearSessionCookies(response);

    expect(clearCookie).toHaveBeenCalledTimes(6);
    for (const name of ["opswatch_session", "opswatch_csrf", "opswatch_token"]) {
      expect(clearCookie).toHaveBeenCalledWith(
        name,
        expect.objectContaining({ domain: ".okanggroup.com", path: "/" })
      );
      expect(clearCookie).toHaveBeenCalledWith(
        name,
        expect.not.objectContaining({ domain: expect.anything() })
      );
    }
  });
});
