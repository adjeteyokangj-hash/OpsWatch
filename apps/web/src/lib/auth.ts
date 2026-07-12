export const setAuthCookie = (token: string): void => {
  document.cookie = `opswatch_token=${token}; path=/; max-age=43200; SameSite=Lax`;
};

export const clearAuthCookie = (): void => {
  document.cookie = "opswatch_token=; path=/; max-age=0; SameSite=Lax";
};

export const getAuthToken = (): string | null => {
  const row = document.cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("opswatch_token="));

  return row ? row.split("=")[1] ?? null : null;
};

export const getAuthClaims = (): Record<string, unknown> | null => {
  const token = getAuthToken();
  if (!token) return null;

  const parts = token.split(".");
  const payload = parts[1];
  if (!payload) return null;

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(base64);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const refreshAuthSession = async (): Promise<boolean> => {
  const token = getAuthToken();
  if (!token) return false;

  const { API_BASE_URL } = await import("./constants");
  const response = await fetch(`${API_BASE_URL}/auth/session`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    cache: "no-store"
  });

  if (!response.ok) {
    clearAuthCookie();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      window.location.href = "/login";
    }
    return false;
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    return false;
  }

  setAuthCookie(data.token);
  return true;
};
