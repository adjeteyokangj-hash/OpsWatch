export const APP_NAME = "OpsWatch";

const LOCAL_API_BASE_URL = "/api";
const DIRECT_API_BASE_URL = "http://localhost:4000/api";

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

export const API_BASE_URL = (() => {
  const configured = process.env.NEXT_PUBLIC_OPSWATCH_API_URL?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_OPSWATCH_API_URL is required in production (e.g. https://your-api.vercel.app/api)"
    );
  }
  // Proxied via next.config rewrites — keeps session cookies on the web origin.
  return LOCAL_API_BASE_URL;
})();

/** Direct API URL for cases that cannot use the Next.js proxy (e.g. e2e against raw API). */
export const DIRECT_API_URL = DIRECT_API_BASE_URL;
