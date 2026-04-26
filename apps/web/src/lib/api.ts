import { API_BASE_URL } from "./constants";

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
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
