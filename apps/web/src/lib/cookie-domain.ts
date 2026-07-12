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

export const resolveSessionCookieDomain = (hostname?: string): string | undefined => {
  const explicit = process.env.NEXT_PUBLIC_OPSWATCH_COOKIE_DOMAIN?.trim();
  if (explicit) {
    return normalizeCookieDomain(explicit);
  }

  if (!hostname) {
    return undefined;
  }

  return deriveParentCookieDomain(hostname);
};
