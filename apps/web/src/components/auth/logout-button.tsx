"use client";

import { useState } from "react";
import { clearAuthCookies, getCsrfToken } from "../../lib/auth";
import { API_BASE_URL } from "../../lib/constants";
import { redirectAfterLogout } from "./logout-navigation";

type LogoutErrorPayload = { error?: string };

const readLogoutError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as LogoutErrorPayload;
    return payload.error?.trim() || `Logout failed (${response.status})`;
  } catch {
    return `Logout failed (${response.status})`;
  }
};

export function LogoutButton({ className = "secondary-button header-logout" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const csrfToken = getCsrfToken();
      const response = await fetch(`${API_BASE_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "x-opswatch-csrf": csrfToken } : undefined,
        cache: "no-store"
      });
      if (!response.ok) throw new Error(await readLogoutError(response));

      const sessionCheck = await fetch(`${API_BASE_URL}/auth/session`, {
        credentials: "include",
        cache: "no-store"
      });
      if (sessionCheck.ok) {
        throw new Error("Logout did not close the server session. Please try again.");
      }
      if (sessionCheck.status !== 401) {
        throw new Error(`Could not verify logout (${sessionCheck.status}). Please try again.`);
      }

      clearAuthCookies();
      redirectAfterLogout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Logout failed. Please try again.");
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
      <button
        type="button"
        className={className}
        onClick={() => void handleLogout()}
        disabled={busy}
        aria-busy={busy}
        data-testid="global-logout"
        data-action="api"
        data-endpoint="/auth/logout"
      >
        {busy ? "Logging out…" : "Logout"}
      </button>
      {error ? (
        <p role="alert" style={{ margin: 0, maxWidth: 360, color: "var(--down)", fontSize: "0.8rem", textAlign: "right" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
