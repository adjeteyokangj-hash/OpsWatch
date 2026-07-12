export const SESSION_COOKIE_NAME = "opswatch_session";
export const CSRF_COOKIE_NAME = "opswatch_csrf";
export const CSRF_HEADER = "x-opswatch-csrf";

export const sessionAbsoluteTtlSeconds = (): number =>
  Number(process.env.SESSION_ABSOLUTE_TTL_SECONDS || 43_200);

export const sessionIdleTtlSeconds = (): number =>
  Number(process.env.SESSION_IDLE_TTL_SECONDS || 1_800);

export const sessionIdleTouchIntervalSeconds = (): number =>
  Number(process.env.SESSION_IDLE_TOUCH_INTERVAL_SECONDS || 60);

/** When true (default), browser requests may authenticate via HttpOnly session cookies. */
export const isSessionAuthEnabled = (): boolean => process.env.SESSION_SIGNING_REQUIRED !== "false";

/** @deprecated Use isSessionAuthEnabled */
export const isSessionSigningConfigured = isSessionAuthEnabled;
