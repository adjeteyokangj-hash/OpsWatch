const isBrowser = (): boolean => typeof window !== "undefined";

/** Absolute OpsWatch API base for app SDKs / env snippets (never bare `/api`). */
export const resolvePublicIngestApiUrl = (): string => {
  const fromEnv =
    process.env.NEXT_PUBLIC_OPSWATCH_INGEST_API_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.OPSWATCH_WEB_URL?.trim() ||
    "";
  if (fromEnv) {
    const withProtocol = /^https?:\/\//i.test(fromEnv) ? fromEnv : `https://${fromEnv}`;
    const trimmed = withProtocol.replace(/\/+$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  if (isBrowser()) {
    return `${window.location.origin}/api`;
  }
  return "https://opswatch.okanggroup.com/api";
};
