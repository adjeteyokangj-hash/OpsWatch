"use client";

import { FormEvent, useEffect, useState } from "react";
import { APP_NAME, API_BASE_URL } from "../../lib/constants";

const DEV_LOGIN_EMAIL =
  process.env.NODE_ENV === "development" ? "adjeteyokangj@gmail.com" : "";

export default function LoginPage() {
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (DEV_LOGIN_EMAIL) {
      setEmail(DEV_LOGIN_EMAIL);
    }
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

      const data = (await response.json()) as { user?: { email?: string } };
      if (!data.user?.email) {
        setError("Sign-in failed: API response did not establish a session.");
        return;
      }

      const sessionCheck = await fetch(`${API_BASE_URL}/auth/session`, {
        credentials: "include",
        cache: "no-store"
      });
      if (!sessionCheck.ok) {
        setError("Sign-in succeeded but the session cookie was not established. Clear site cookies and try again.");
        return;
      }

      window.location.href = "/dashboard";
    } catch {
      setError("Sign-in failed: API unavailable. Start the API server and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="auth-hero-content">
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
          <h1>Command Center</h1>
          <p>Central monitoring for every client application — health, alerts, incidents, and automation in one place.</p>
          <ul className="auth-feature-list">
            <li>Four-layer health across apps, modules, workflows, and components</li>
            <li>Incident response with causal graphs and remediation</li>
            <li>Automation playbooks with operator safeguards</li>
          </ul>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <h2>Sign in</h2>
          <p className="dashboard-subtle">Use your OpsWatch platform account.</p>
          {mounted ? (
            <form onSubmit={onSubmit}>
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </label>
              {error ? <div className="error-chip">{error}</div> : null}
              <button type="submit" className="primary-button auth-submit" disabled={submitting} data-action="api" data-endpoint="/auth/login">
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form aria-hidden="true">
              <label>
                Email
                <input type="email" value="" disabled readOnly />
              </label>
              <label>
                Password
                <input type="password" value="" disabled readOnly />
              </label>
              <button type="button" className="primary-button" disabled>
                Sign in
              </button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
