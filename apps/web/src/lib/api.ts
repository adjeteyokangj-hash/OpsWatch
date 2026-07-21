import { API_BASE_URL } from "./constants";
import { clearAuthCookies, getCsrfToken } from "./auth";

/** Prefer the page hostname so session cookies set on 127.0.0.1 are not dropped on localhost. */
const localApiFallbackBase = (): string => {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:4000/api";
  }
  const host = window.location.hostname === "localhost" ? "localhost" : "127.0.0.1";
  return `http://${host}:4000/api`;
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const shouldTryLocalFallback = (status: number, baseUrl: string): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  if (status !== 404 && status < 500) {
    return false;
  }

  const isLocalHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isLocalHost) {
    return false;
  }

  const normalizedBase = trimTrailingSlash(baseUrl);
  const fallback = trimTrailingSlash(localApiFallbackBase());
  const isRelativeBase = normalizedBase.startsWith("/");
  const isSameOriginBase = normalizedBase.startsWith(window.location.origin);
  const isAlreadyFallback = normalizedBase === fallback;

  return (isRelativeBase || isSameOriginBase) && !isAlreadyFallback;
};

const buildHeaders = (init?: RequestInit): HeadersInit => {
  const method = (init?.method || "GET").toUpperCase();
  const csrfToken = getCsrfToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined)
  };

  if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers["x-opswatch-csrf"] = csrfToken;
  }

  return headers;
};

export type ApiFetchOptions = RequestInit & {
  suppressAuthRedirect?: boolean;
};

/** Snapshot from GET /intelligence/feature-gates → operatingProfile */
export type AiOperatingProfile = "safety_gated" | "ai_led_safe";

export type AiOperatingProfileFlagRow = {
  envVar: string;
  enabled: boolean;
  profileDefault: boolean;
  explicitOverride: "true" | "false" | null;
};

export type AiOperatingProfileSnapshot = {
  profile: AiOperatingProfile;
  envVar: "OPSWATCH_AI_OPERATING_PROFILE";
  description: string;
  effectiveFlags: AiOperatingProfileFlagRow[];
};

/** Runtime proof payload from GET /intelligence/operations-status */
export type OpsStatusTone = "green" | "amber" | "red";

export type AiOperationsStatusCapability = {
  id: string;
  label: string;
  tone: OpsStatusTone;
  summary: string;
  lastEvidenceAt: string | null;
  evidence: Record<string, unknown>;
};

export type AiOperationsStatusPayload = {
  asOf: string;
  overall: {
    modeLabel: string;
    tone: OpsStatusTone;
    summary: string;
  };
  lastAiDecision: {
    at: string | null;
    summary: string | null;
    kind: string | null;
  };
  capabilities: AiOperationsStatusCapability[];
  blocked: Array<{ id: string; label: string; reason: string }>;
  recentDecisions: Array<{
    id: string;
    kind: "audit" | "automation" | "prediction";
    summary: string;
    decisionType: string | null;
    confidence: number | null;
    outcome: string | null;
    at: string;
  }>;
};

const toNetworkError = (error: unknown, path: string): Error => {
  const detail = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed|aborted/i.test(detail)) {
    return new Error(
      `API unreachable for ${path}. The OpsWatch API did not respond (timeout, outage, or proxy misconfiguration).`
    );
  }
  return error instanceof Error ? error : new Error(detail || `Request failed for ${path}`);
};

const DEFAULT_API_TIMEOUT_MS = 30_000;

const withTimeout = (init: RequestInit, timeoutMs: number): { init: RequestInit; cancel: () => void } => {
  if (init.signal) {
    return { init, cancel: () => undefined };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    init: { ...init, signal: controller.signal },
    cancel: () => clearTimeout(timer)
  };
};

export const apiFetch = async <T>(path: string, init?: ApiFetchOptions): Promise<T> => {
  const { suppressAuthRedirect, ...requestInit } = init ?? {};
  const baseInit: RequestInit = {
    ...requestInit,
    headers: buildHeaders(requestInit),
    credentials: "include",
    cache: "no-store"
  };

  let response: Response;
  const primary = withTimeout(baseInit, DEFAULT_API_TIMEOUT_MS);
  try {
    response = await fetch(`${API_BASE_URL}${path}`, primary.init);
  } catch (error) {
    primary.cancel();
    throw toNetworkError(error, path);
  }
  primary.cancel();

  if (!response.ok && shouldTryLocalFallback(response.status, API_BASE_URL)) {
    const fallback = withTimeout(baseInit, DEFAULT_API_TIMEOUT_MS);
    try {
      response = await fetch(`${localApiFallbackBase()}${path}`, fallback.init);
    } catch (error) {
      fallback.cancel();
      throw toNetworkError(error, path);
    }
    fallback.cancel();
  }

  if (response.status === 401 && !suppressAuthRedirect && typeof window !== "undefined") {
    clearAuthCookies();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login?reason=session_expired";
    }
  }

  if (!response.ok) {
    let detail = "";
    let code = "";
    try {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as {
          error?: string | { message?: string };
          message?: string;
          code?: string;
        };
        detail = typeof payload?.error === "string" ? payload.error : payload?.error?.message || payload?.message || "";
        code = typeof payload?.code === "string" ? payload.code : "";
      } else {
        detail = (await response.text()).trim();
      }
    } catch {
      detail = "";
    }

    // A valid session with a stale/mismatched CSRF token cannot perform writes.
    // There is no silent CSRF-refresh endpoint (only login/rotate re-issue the
    // cookies), so the only recovery is to force a fresh sign-in, which re-issues
    // consistent session + CSRF cookies. This never disables or bypasses CSRF.
    const isCsrfFailure =
      response.status === 403 && (code === "CSRF_INVALID" || /invalid csrf token/i.test(detail));
    if (isCsrfFailure && !suppressAuthRedirect && typeof window !== "undefined") {
      clearAuthCookies();
      if (!window.location.pathname.startsWith("/login")) {
        window.location.href = "/login?reason=session_expired";
      }
      throw new Error("Your session security token has expired. Please sign in again.");
    }

    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};
