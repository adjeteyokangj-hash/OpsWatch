"use client";

import { FormEvent, useState } from "react";
import { APP_NAME, API_BASE_URL } from "../../lib/constants";
import { setAuthCookie } from "../../lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@opswatch.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        let message = "Invalid credentials";
        try {
          const payload = (await response.json()) as { error?: string; message?: string };
          if (payload?.error || payload?.message) {
            message = payload.error || payload.message || message;
          }
        } catch {
          // Keep default message when backend doesn't return JSON.
        }
        setError(message);
        return;
      }

      const data = (await response.json()) as { token?: string; accessToken?: string };
      const token = data.token || data.accessToken;
      if (!token) {
        setError("Sign-in failed: API response did not include a token.");
        return;
      }

      setAuthCookie(token);
      window.location.href = "/dashboard";
    } catch {
      setError("Sign-in failed: API unavailable. Start the API server and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-wrap">
      <section className="auth-card">
        <div className="auth-logo-wrap">
          <div className="auth-logo">
            {logoMissing ? (
              <span className="auth-logo-wordmark" aria-label={APP_NAME}>
                Ops<span className="auth-logo-accent">Watch</span>
              </span>
            ) : (
              <img
                src="/brand/opswatch-logo-light.png"
                alt="OpsWatch"
                className="auth-logo-img"
                onError={() => setLogoMissing(true)}
              />
            )}
          </div>
        </div>
        <p>Central monitoring for every client application.</p>
        <form onSubmit={onSubmit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error ? <div className="error-chip">{error}</div> : null}
          <button type="submit" disabled={submitting} data-action="api" data-endpoint="/auth/login">{submitting ? "Signing in..." : "Sign In"}</button>
        </form>
      </section>
    </main>
  );
}
