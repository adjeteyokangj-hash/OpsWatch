"use client";

import { FormEvent, useState } from "react";
import { APP_NAME, API_BASE_URL } from "../../lib/constants";
import { setAuthCookie } from "../../lib/auth";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@opswatch.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        setError("Invalid credentials");
        return;
      }

      const data = (await response.json()) as { token: string };
      setAuthCookie(data.token);
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
        <h1>{APP_NAME}</h1>
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
          <button type="submit" disabled={submitting}>{submitting ? "Signing in..." : "Sign In"}</button>
        </form>
      </section>
    </main>
  );
}
