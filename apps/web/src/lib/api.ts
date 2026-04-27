import { API_BASE_URL } from "./constants";
import { clearAuthCookie } from "./auth";

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

const getToken = (): string | undefined => {
  if (typeof document === "undefined") {
    return undefined;
  }

  const row = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("opswatch_token="));

  return row?.split("=")[1];
};

export const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const token = getToken();
  const requestInit: RequestInit = {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {})
    },
    cache: "no-store"
  };

  let response = await fetch(`${API_BASE_URL}${path}`, requestInit);

  if (!response.ok && shouldTryLocalFallback(response.status, API_BASE_URL)) {
    response = await fetch(`${LOCAL_API_FALLBACK}${path}`, requestInit);
  }

  if (response.status === 401 && typeof window !== "undefined") {
    clearAuthCookie();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
  }

  if (!response.ok) {
    let detail = "";
    try {
      const contentType = response.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const payload = (await response.json()) as { error?: string; message?: string };
        detail = payload?.error || payload?.message || "";
      } else {
        detail = (await response.text()).trim();
      }
    } catch {
      detail = "";
    }

    throw new Error(detail ? `API request failed: ${response.status} - ${detail}` : `API request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return undefined as T;
  }

  return (await response.json()) as T;
};
