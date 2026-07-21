import { API_BASE_URL } from "./constants";
import { resolveSessionCookieDomain } from "./cookie-domain";

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  organizationId?: string | null;
  name?: string;
  isPlatformSuperAdmin?: boolean;
};

/** Keep shell / dashboard gates from hanging forever when /auth/session stalls. */
export const SESSION_FETCH_TIMEOUT_MS = 12_000;
const SESSION_CACHE_TTL_MS = 5_000;

type SessionCache = {
  user: SessionUser | null;
  at: number;
};

let inFlightSession: Promise<SessionUser | null> | null = null;
let sessionCache: SessionCache | null = null;

const parseCookie = (name: string): string | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const prefix = `${name}=`;
  const matches = document.cookie
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith(prefix));

  // The API parses the Cookie header with "last occurrence wins" semantics.
  // If a duplicate cookie exists (e.g. a host-only cookie plus a domain-scoped
  // one after a cookie-domain change), reading the FIRST match would send a
  // token the server does not validate against — producing "Invalid CSRF token"
  // on every write. Mirror the server and read the LAST match.
  const row = matches.at(-1);
  if (!row) {
    return null;
  }
  const separator = row.indexOf("=");
  return decodeURIComponent(row.slice(separator + 1));
};

export const getCsrfToken = (): string | null => parseCookie("opswatch_csrf");

export const hasSessionCookie = (): boolean => Boolean(parseCookie("opswatch_session"));

export const invalidateAuthSessionCache = (): void => {
  sessionCache = null;
  inFlightSession = null;
};

export const clearAuthCookies = (): void => {
  invalidateAuthSessionCache();

  if (typeof document === "undefined") {
    return;
  }

  const domain = resolveSessionCookieDomain(window.location.hostname);
  // Clear both the domain-scoped and host-only variants. A stale host-only
  // duplicate left over from an earlier cookie-domain configuration would
  // otherwise survive re-login and keep breaking CSRF validation.
  const domainAttrs = domain ? [`; domain=${domain}`, ""] : [""];

  for (const domainAttr of domainAttrs) {
    document.cookie = `opswatch_session=; path=/; max-age=0; SameSite=Lax${domainAttr}`;
    document.cookie = `opswatch_csrf=; path=/; max-age=0; SameSite=Lax${domainAttr}`;
  }
};

/** @deprecated Browser JWT cookies are no longer used. */
export const clearAuthCookie = clearAuthCookies;

type RefreshSessionOptions = {
  /** Bypass short-lived cache and in-flight coalescing. */
  force?: boolean;
  /** Override default session fetch timeout. */
  timeoutMs?: number;
};

/**
 * Resolve the authenticated user via same-origin `/auth/session`.
 * Coalesces concurrent callers (Shell + Sidebar + pages) and aborts on timeout
 * so mobile/desktop UIs never stick on “Loading workspace…” forever.
 */
export const refreshAuthSession = async (
  options: RefreshSessionOptions = {}
): Promise<SessionUser | null> => {
  const force = Boolean(options.force);
  const timeoutMs = options.timeoutMs ?? SESSION_FETCH_TIMEOUT_MS;

  if (!force && sessionCache && Date.now() - sessionCache.at < SESSION_CACHE_TTL_MS) {
    return sessionCache.user;
  }

  if (!force && inFlightSession) {
    return inFlightSession;
  }

  const request = (async (): Promise<SessionUser | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/session`, {
        credentials: "include",
        cache: "no-store",
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 401) {
          // clearAuthCookies also invalidates the session cache.
          clearAuthCookies();
          if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
            window.location.href = "/login?reason=session_expired";
          }
          return null;
        }
        sessionCache = { user: null, at: Date.now() };
        return null;
      }

      const data = (await response.json()) as { user?: SessionUser };
      const user = data.user ?? null;
      sessionCache = { user, at: Date.now() };
      return user;
    } catch {
      // Timed out or network error — do not treat as signed-out; pages can still
      // load org-scoped data with existing cookies. Shell may show a non-blocking retry.
      return sessionCache?.user ?? null;
    } finally {
      clearTimeout(timer);
    }
  })();

  inFlightSession = request;
  try {
    return await request;
  } finally {
    if (inFlightSession === request) {
      inFlightSession = null;
    }
  }
};

export const fetchSessionUser = refreshAuthSession;

/** @deprecated Decode JWT claims from browser storage. Use refreshAuthSession instead. */
export const getAuthClaims = (): Record<string, unknown> | null => null;

/** @deprecated JWT tokens are no longer stored in the browser. */
export const getAuthToken = (): string | null => null;

/** @deprecated JWT tokens are no longer stored in the browser. */
export const setAuthCookie = (_token: string): void => undefined;
