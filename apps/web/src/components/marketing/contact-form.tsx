"use client";

import { FormEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { API_BASE_URL } from "../../lib/constants";

type ContactResponse = {
  ok: boolean;
  message?: string;
  delivery?: "accepted" | "logged";
  error?: string;
};

export function ContactForm() {
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic");
  const defaultMessage = useMemo(() => {
    if (topic === "enterprise") {
      return "I would like to discuss Enterprise pricing and onboarding for our application estate.";
    }
    return "";
  }, [topic]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState(defaultMessage);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/public/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, message, topic: topic || undefined })
      });
      const payload = (await response.json()) as ContactResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.error || "Could not send your message. Please try again.");
        return;
      }
      setSuccess(
        payload.message ||
          "Thanks. Your message was received. Our team will respond by email."
      );
      setName("");
      setEmail("");
      setCompany("");
      setMessage("");
    } catch {
      setError("Could not reach OpsWatch. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="ow-contact-form" onSubmit={(event) => void onSubmit(event)} noValidate>
      <label>
        Full name
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          maxLength={120}
          autoComplete="name"
        />
      </label>
      <label>
        Work email
        <input
          type="email"
          name="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={200}
          autoComplete="email"
        />
      </label>
      <label>
        Company
        <input
          name="company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
          maxLength={160}
          autoComplete="organization"
        />
      </label>
      <label>
        Message
        <textarea
          name="message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
          rows={6}
          maxLength={4000}
        />
      </label>
      {error ? (
        <p className="ow-form-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="ow-form-success" role="status">
          {success}
        </p>
      ) : null}
      <button type="submit" className="ow-btn ow-btn-primary" disabled={submitting}>
        {submitting ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}
