const normalizeCookieDomain = (value: string): string =>
  value.startsWith(".") ? value : `.${value}`;

export const deriveParentCookieDomain = (hostname: string): string | undefined => {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized || normalized === "localhost" || normalized === "127.0.0.1") {
    return undefined;
  }

  if (normalized.endsWith(".vercel.app")) {
    return undefined;
  }

  const parts = normalized.split(".").filter(Boolean);
  if (parts.length < 2) {
    return undefined;
  }

  return `.${parts.slice(-2).join(".")}`;
};

export const resolveSessionCookieDomain = (): string | undefined => {
  const explicit = process.env.OPSWATCH_COOKIE_DOMAIN?.trim();
  if (explicit) {
    return normalizeCookieDomain(explicit);
  }

  if (process.env.NODE_ENV !== "production") {
    return undefined;
  }

  const webUrl = process.env.OPSWATCH_WEB_URL?.trim();
  if (!webUrl) {
    return undefined;
  }

  try {
    return deriveParentCookieDomain(new URL(webUrl).hostname);
  } catch {
    return undefined;
  }
};
