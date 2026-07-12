import { API_BASE_URL } from "./constants";
import { resolveSessionCookieDomain } from "./cookie-domain";

export type SessionUser = {
  id: string;
  email: string;
  role: string;
  organizationId?: string | null;
  name?: string;
};

const parseCookie = (name: string): string | null => {
  if (typeof document === "undefined") {
    return null;
  }

  const row = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`));

  return row ? decodeURIComponent(row.split("=")[1] ?? "") : null;
};

export const getCsrfToken = (): string | null => parseCookie("opswatch_csrf");

export const hasSessionCookie = (): boolean => Boolean(parseCookie("opswatch_session"));

export const clearAuthCookies = (): void => {
  if (typeof document === "undefined") {
    return;
  }

  const domain = resolveSessionCookieDomain(window.location.hostname);
  const domainAttr = domain ? `; domain=${domain}` : "";

  document.cookie = `opswatch_session=; path=/; max-age=0; SameSite=Lax${domainAttr}`;
  document.cookie = `opswatch_csrf=; path=/; max-age=0; SameSite=Lax${domainAttr}`;
};

/** @deprecated Browser JWT cookies are no longer used. */
export const clearAuthCookie = clearAuthCookies;

export const refreshAuthSession = async (): Promise<SessionUser | null> => {
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    clearAuthCookies();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    return null;
  }

  const data = (await response.json()) as { user?: SessionUser };
  return data.user ?? null;
};

export const fetchSessionUser = refreshAuthSession;

/** @deprecated Decode JWT claims from browser storage. Use refreshAuthSession instead. */
export const getAuthClaims = (): Record<string, unknown> | null => null;

/** @deprecated JWT tokens are no longer stored in the browser. */
export const getAuthToken = (): string | null => null;

/** @deprecated JWT tokens are no longer stored in the browser. */
export const setAuthCookie = (_token: string): void => undefined;
