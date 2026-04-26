"use client";

import { FormEvent, useState } from "react";
import { API_BASE_URL } from "../../lib/constants";

export default function RegisterPage() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    orgName: "",
    orgSlug: ""
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSlug = (e: React.ChangeEvent<HTMLInputElement>) => {
    const slug = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    setForm((f) => ({ ...f, orgSlug: slug }));
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        email: form.email,
        password: form.password,
        orgName: form.orgName || undefined,
        orgSlug: form.orgSlug || undefined
      })
    });

    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error || "Registration failed");
      return;
    }

    setSuccess(true);
  };

  if (success) {
    return (
      <main className="auth-wrap">
        <section className="auth-card">
          <h1>Account created!</h1>
          <p>Your account is ready. <a href="/login">Sign in now →</a></p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-wrap">
      <section className="auth-card auth-card--wide">
        <h1>Create account</h1>
        <p>Set up your OpsWatch workspace.</p>
        <form onSubmit={(e) => void onSubmit(e)}>
          <fieldset className="form-section">
            <legend>Your details</legend>
            <label>
              Full name
              <input value={form.name} onChange={set("name")} required placeholder="Jane Smith" />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={set("email")} required placeholder="you@example.com" />
            </label>
            <label>
              Password
              <input type="password" value={form.password} onChange={set("password")} required minLength={8} />
            </label>
            <label>
              Confirm password
              <input type="password" value={form.confirmPassword} onChange={set("confirmPassword")} required />
            </label>
          </fieldset>

          <fieldset className="form-section">
            <legend>Organization (optional)</legend>
            <label>
              Organization name
              <input
                value={form.orgName}
                onChange={(e) => {
                  const name = e.target.value;
                  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
                  setForm((f) => ({ ...f, orgName: name, orgSlug: slug }));
                }}
                placeholder="Acme Corp"
              />
            </label>
            <label>
              URL slug
              <input value={form.orgSlug} onChange={handleSlug} placeholder="acme-corp" />
            </label>
          </fieldset>

          {error ? <div className="error-chip">{error}</div> : null}
          <button type="submit">Create account</button>
          <p className="auth-alt">Already have an account? <a href="/login">Sign in</a></p>
        </form>
      </section>
    </main>
  );
}
