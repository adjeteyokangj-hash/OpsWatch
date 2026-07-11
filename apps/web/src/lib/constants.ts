export const APP_NAME = "OpsWatch";

const LOCAL_API_BASE_URL = "http://localhost:4000/api";

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
  return LOCAL_API_BASE_URL;
})();
