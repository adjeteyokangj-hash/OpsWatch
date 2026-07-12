import { API_BASE_URL } from "./constants";
import { clearAuthCookies, getCsrfToken } from "./auth";

const LOCAL_API_FALLBACK = "http://localhost:4000/api";

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
  const isRelativeBase = normalizedBase.startsWith("/");
  const isSameOriginBase = normalizedBase.startsWith(window.location.origin);
  const isAlreadyFallback = normalizedBase === LOCAL_API_FALLBACK;

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

export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const requestInit: RequestInit = {
    ...init,
    headers: buildHeaders(init),
    credentials: "include",
    cache: "no-store"
  };

  let response = await fetch(`${API_BASE_URL}${path}`, requestInit);

  if (!response.ok && shouldTryLocalFallback(response.status, API_BASE_URL)) {
    response = await fetch(`${LOCAL_API_FALLBACK}${path}`, requestInit);
  }

  if (response.status === 401 && typeof window !== "undefined") {
    clearAuthCookies();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    let detail = "";
    try {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { error?: string | { message?: string }; message?: string };
        detail = typeof payload?.error === "string" ? payload.error : payload?.error?.message || payload?.message || "";
      } else {
        detail = (await response.text()).trim();
      }
    } catch {
      detail = "";
    }

    throw new Error(detail || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};
