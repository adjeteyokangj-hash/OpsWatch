import type { CookieOptions, Response } from "express";
import { resolveSessionCookieDomain } from "../config/cookie-domain";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sessionAbsoluteTtlSeconds
} from "../config/session";

const LEGACY_TOKEN_COOKIE_NAME = "opswatch_token";

export const parseCookieHeader = (header: string | undefined): Record<string, string> => {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((cookies, part) => {
    const separator = part.indexOf("=");
    if (separator <= 0) {
      return cookies;
    }

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) {
      return cookies;
    }

    cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
};

const baseCookieOptions = (): CookieOptions => {
  const domain = resolveSessionCookieDomain();
  return {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    ...(domain ? { domain } : {})
  };
};

export const setSessionCookies = (
  res: Response,
  sessionToken: string,
  csrfToken: string
): void => {
  const maxAgeMs = sessionAbsoluteTtlSeconds() * 1000;
  res.cookie(SESSION_COOKIE_NAME, sessionToken, {
    ...baseCookieOptions(),
    httpOnly: true,
    maxAge: maxAgeMs
  });
  res.cookie(CSRF_COOKIE_NAME, csrfToken, {
    ...baseCookieOptions(),
    httpOnly: false,
    maxAge: maxAgeMs
  });
};

const clearCookieEveryScope = (
  res: Response,
  name: string,
  options: CookieOptions
): void => {
  res.clearCookie(name, options);

  if (options.domain) {
    const { domain: _domain, ...hostOnlyOptions } = options;
    res.clearCookie(name, hostOnlyOptions);
  }
};

export const clearSessionCookies = (res: Response): void => {
  const base = baseCookieOptions();
  clearCookieEveryScope(res, SESSION_COOKIE_NAME, { ...base, httpOnly: true });
  clearCookieEveryScope(res, CSRF_COOKIE_NAME, { ...base, httpOnly: false });
  clearCookieEveryScope(res, LEGACY_TOKEN_COOKIE_NAME, { ...base, httpOnly: false });
};

export const readSessionToken = (cookieHeader: string | undefined): string | null =>
  parseCookieHeader(cookieHeader)[SESSION_COOKIE_NAME]?.trim() || null;

export const readCsrfToken = (cookieHeader: string | undefined): string | null =>
  parseCookieHeader(cookieHeader)[CSRF_COOKIE_NAME]?.trim() || null;

export const sessionCookieFlags = (): string[] => {
  const flags = ["HttpOnly", "Path=/", "SameSite=Lax"];
  const domain = resolveSessionCookieDomain();
  if (domain) {
    flags.push(`Domain=${domain}`);
  }
  if (process.env.NODE_ENV === "production") {
    flags.push("Secure");
  }
  return flags;
};

export const csrfCookieFlags = (): string[] => {
  const flags = ["Path=/", "SameSite=Lax"];
  const domain = resolveSessionCookieDomain();
  if (domain) {
    flags.push(`Domain=${domain}`);
  }
  if (process.env.NODE_ENV === "production") {
    flags.push("Secure");
  }
  return flags;
};
