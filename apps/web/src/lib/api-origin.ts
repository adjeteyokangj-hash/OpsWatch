const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const stripApiSuffix = (value: string): string => trimTrailingSlash(value).replace(/\/api$/i, "");

const isAbsoluteUrl = (value: string): boolean =>
  value.startsWith("http://") || value.startsWith("https://");

/**
 * Upstream OpsWatch API host for the Next.js /api proxy and middleware session checks.
 * Supports legacy production config where only NEXT_PUBLIC_OPSWATCH_API_URL pointed at the API.
 */
export const resolveOpswatchApiOrigin = (): string => {
  const explicit = process.env.OPSWATCH_API_ORIGIN?.trim();
  if (explicit) {
    return stripApiSuffix(explicit);
  }

  const apiUrl = process.env.OPSWATCH_API_URL?.trim();
  if (apiUrl) {
    return stripApiSuffix(apiUrl);
  }

  const publicUrl = process.env.NEXT_PUBLIC_OPSWATCH_API_URL?.trim();
  if (publicUrl && isAbsoluteUrl(publicUrl)) {
    return stripApiSuffix(publicUrl);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Configure OPSWATCH_API_ORIGIN or NEXT_PUBLIC_OPSWATCH_API_URL (absolute API URL) for the web proxy"
    );
  }

  return "http://127.0.0.1:4000";
};

/** Browser-facing API base — always same-origin so session cookies stay on the web host. */
export const CLIENT_API_BASE_URL = "/api";

/**
 * Prefer in-process API on Vercel (same-origin). Proxy only when explicitly forced off.
 * Having OPSWATCH_API_ORIGIN set without OPSWATCH_EMBEDDED_API=false used to force a
 * second serverless hop, which commonly surfaces as browser "Failed to fetch".
 */
export const shouldUseEmbeddedOpswatchApi = (): boolean => {
  if (process.env.OPSWATCH_EMBEDDED_API === "true") {
    return true;
  }
  if (process.env.OPSWATCH_EMBEDDED_API === "false") {
    return false;
  }
  // Local split-dev keeps proxying when an absolute API origin is configured.
  if (process.env.OPSWATCH_API_ORIGIN?.trim() && process.env.VERCEL !== "1") {
    return false;
  }
  return true;
};
