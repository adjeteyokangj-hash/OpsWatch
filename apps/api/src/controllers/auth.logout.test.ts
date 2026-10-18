import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSessionToken, clearSessionCookies, revokeSessionToken, loggerWarn, tryAttachSession, validateSessionCsrfRequest } = vi.hoisted(() => ({
  readSessionToken: vi.fn(),
  clearSessionCookies: vi.fn(),
  revokeSessionToken: vi.fn(),
  loggerWarn: vi.fn(),
  tryAttachSession: vi.fn(async () => false),
  validateSessionCsrfRequest: vi.fn(() => true)
}));

vi.mock("../services/auth.service", () => ({
  AuthError: class AuthError extends Error { code = "TEST"; },
  PasswordPolicyError: class PasswordPolicyError extends Error {},
  changePassword: vi.fn(),
  getSessionUser: vi.fn(),
  login: vi.fn()
}));
vi.mock("../lib/session-cookie", () => ({
  readSessionToken,
  clearSessionCookies,
  setSessionCookies: vi.fn()
}));
vi.mock("../services/session.service", () => ({
  revokeSessionToken,
  createUserSession: vi.fn(),
  rotateUserSession: vi.fn()
}));
vi.mock("../config/logger", () => ({ logger: { warn: loggerWarn } }));
vi.mock("../middleware/auth", () => ({
  tryAttachSession,
  validateSessionCsrfRequest
}));

import { logoutController } from "./auth.controller";

const makeResponse = () => {
  const send = vi.fn();
  const json = vi.fn();
  const status = vi.fn(() => ({ send, json }));
  return { status, send, json };
};

describe("logoutController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("revokes a valid token, clears cookies and returns 204", async () => {
    readSessionToken.mockReturnValue("session-token");
    revokeSessionToken.mockResolvedValue(undefined);
    const response = makeResponse();

    await logoutController(
      { headers: { cookie: "opswatch_session=session-token" } } as never,
      response as never
    );

    expect(revokeSessionToken).toHaveBeenCalledWith("session-token", "LOGOUT");
    expect(clearSessionCookies).toHaveBeenCalledWith(response);
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalledTimes(1);
  });

  it("still clears cookies when a stale token cannot be revoked", async () => {
    readSessionToken.mockReturnValue("stale-token");
    revokeSessionToken.mockRejectedValue(new Error("session store unavailable"));
    const response = makeResponse();

    await logoutController(
      { headers: { cookie: "opswatch_session=stale-token" } } as never,
      response as never
    );

    expect(clearSessionCookies).toHaveBeenCalledWith(response);
    expect(response.status).toHaveBeenCalledWith(204);
    expect(loggerWarn).toHaveBeenCalledWith(
      "Session revocation failed during logout",
      expect.objectContaining({ reason: "session store unavailable" })
    );
  });

  it("does not revoke a live session when the CSRF header is missing", async () => {
    tryAttachSession.mockResolvedValue(true);
    validateSessionCsrfRequest.mockReturnValue(false);
    const response = makeResponse();

    await logoutController(
      { headers: { cookie: "opswatch_session=session-token" } } as never,
      response as never
    );

    expect(revokeSessionToken).not.toHaveBeenCalled();
    expect(clearSessionCookies).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
  });
});
