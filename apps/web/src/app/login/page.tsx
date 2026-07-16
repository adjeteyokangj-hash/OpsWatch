"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { APP_NAME, API_BASE_URL } from "../../lib/constants";
import { SESSION_FETCH_TIMEOUT_MS } from "../../lib/auth";

const DEV_LOGIN_EMAIL =
  process.env.NODE_ENV === "development" ? "admin@opswatch.local" : "";

export default function LoginPage() {
  const [mounted, setMounted] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [logoMissing, setLogoMissing] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window === "undefined") return;
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (reason === "session_expired") {
      setSessionNotice("Your session expired. Sign in again to continue.");
    }
  }, []);

  // Prefill only when the field is still empty so automation fill() is not raced.
  useEffect(() => {
    if (!DEV_LOGIN_EMAIL) return;
    setEmail((current) => (current ? current : DEV_LOGIN_EMAIL));
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

      const sessionController = new AbortController();
      const sessionTimer = window.setTimeout(() => sessionController.abort(), SESSION_FETCH_TIMEOUT_MS);
      let sessionCheck: Response;
      try {
        sessionCheck = await fetch(`${API_BASE_URL}/auth/session`, {
          credentials: "include",
          cache: "no-store",
          signal: sessionController.signal
        });
      } catch {
        setError(
          "Sign-in succeeded but session confirmation timed out. Refresh the page or try again; if this persists, the API may be overloaded."
        );
        return;
      } finally {
        window.clearTimeout(sessionTimer);
      }
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
              <Image
                src="/brand/opswatch-logo-light.png"
                alt="OpsWatch"
                width={280}
                height={64}
                className="auth-logo-img"
                priority
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
          {sessionNotice ? (
            <p className="dashboard-subtle" role="status" data-testid="login-session-notice">
              {sessionNotice}
            </p>
          ) : null}
          {mounted ? (
            <form onSubmit={onSubmit} data-testid="login-form">
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  data-testid="login-email"
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
                  data-testid="login-password"
                />
              </label>
              {error ? <div className="error-chip" role="alert" data-testid="login-error">{error}</div> : null}
              <button
                type="submit"
                className="primary-button auth-submit"
                disabled={submitting}
                data-action="api"
                data-endpoint="/auth/login"
                data-testid="login-submit"
              >
                {submitting ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <div className="dashboard-subtle" aria-live="polite" data-testid="login-hydrating">
              Loading sign-in…
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
