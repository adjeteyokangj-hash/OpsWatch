import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./constants", () => ({ API_BASE_URL: "http://api.test" }));

const getCsrfToken = vi.fn<[], string | null>();
const clearAuthCookies = vi.fn();

vi.mock("./auth", () => ({
  getCsrfToken: () => getCsrfToken(),
  clearAuthCookies: () => clearAuthCookies()
}));

import { apiFetch } from "./api";

type ResponseInit = {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
  contentType?: string;
};

const makeResponse = (opts: ResponseInit) =>
  ({
    ok: opts.ok,
    status: opts.status,
    headers: {
      get: (header: string) =>
        header.toLowerCase() === "content-type" ? opts.contentType ?? "application/json" : null
    },
    json: async () => opts.json,
    text: async () => opts.text ?? ""
  }) as unknown as Response;

const fetchMock = vi.fn();

const setLocation = (pathname: string) => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { pathname, href: "", hostname: "app.test", origin: "http://app.test" }
  });
};

describe("apiFetch CSRF handling", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getCsrfToken.mockReset();
    clearAuthCookies.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    setLocation("/projects/p/billing");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the x-opswatch-csrf header on a PATCH when a token is present", async () => {
    getCsrfToken.mockReturnValue("tok-1");
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, json: { ok: true } }));

    await apiFetch("/projects/p/billing", { method: "PATCH", body: "{}" });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-opswatch-csrf"]).toBe("tok-1");
  });

  it("does not send the CSRF header on a GET request", async () => {
    getCsrfToken.mockReturnValue("tok-1");
    fetchMock.mockResolvedValue(makeResponse({ ok: true, status: 200, json: { ok: true } }));

    await apiFetch("/projects/p/billing");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-opswatch-csrf"]).toBeUndefined();
  });

  it("recovers from a 403 CSRF_INVALID by clearing auth and redirecting to login", async () => {
    getCsrfToken.mockReturnValue("stale");
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 403,
        json: { error: "Invalid CSRF token", code: "CSRF_INVALID" }
      })
    );

    await expect(apiFetch("/projects/p/billing", { method: "PATCH", body: "{}" })).rejects.toThrow(
      /sign in again/i
    );

    expect(clearAuthCookies).toHaveBeenCalledTimes(1);
    expect(window.location.href).toContain("/login");
  });

  it("does not redirect on CSRF failure when suppressAuthRedirect is set", async () => {
    getCsrfToken.mockReturnValue("stale");
    fetchMock.mockResolvedValue(
      makeResponse({
        ok: false,
        status: 403,
        json: { error: "Invalid CSRF token", code: "CSRF_INVALID" }
      })
    );

    await expect(
      apiFetch("/projects/p/billing", { method: "PATCH", body: "{}", suppressAuthRedirect: true })
    ).rejects.toThrow(/invalid csrf token/i);

    expect(clearAuthCookies).not.toHaveBeenCalled();
    expect(window.location.href).toBe("");
  });
});
