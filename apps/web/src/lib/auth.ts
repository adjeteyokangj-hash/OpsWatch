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
