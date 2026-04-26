import { RemediationAction } from "../remediation/actions";

export interface DiagnosisInput {
  alertType?: string;       // sourceType on Alert or EventType
  eventTypes?: string[];    // recent event types on the service/project
  severity?: string;
  serviceType?: string;
  title?: string;
  message?: string;
}

export interface DiagnosisOutput {
  diagnosis: string;
  confidence: number;       // 0.0 – 1.0
  suggestedActions: RemediationAction[];
  category: string;         // one of the 5 risk layers
}

/**
 * Rule-based AI diagnosis engine.
 *
 * Each rule matches on alert/event signals and returns a diagnosis with
 * confidence-weighted suggested remediation actions.
 *
 * EXTENSION POINT: replace or augment with an OpenAI call by doing:
 *   const aiResponse = await openai.chat.completions.create({ model: "gpt-4o-mini", ... })
 * and merging the result with the rule-based output.
 */
export function diagnose(input: DiagnosisInput): DiagnosisOutput {
  const signals = [
    input.alertType?.toUpperCase() ?? "",
    ...(input.eventTypes ?? []).map((t) => t.toUpperCase()),
    input.title?.toUpperCase() ?? "",
    input.message?.toUpperCase() ?? "",
  ].join(" ");

  // ── Availability ──────────────────────────────────────────────────────────
  if (matches(signals, ["SERVICE_DOWN", "DOWN", "HTTP_FAIL", "UNREACHABLE", "NOT RESPONDING"])) {
    return {
      diagnosis: "Service is not responding to health checks. The process may have crashed, been OOM-killed, or lost network connectivity.",
      confidence: 0.9,
      category: "AVAILABILITY",
      suggestedActions: ["RERUN_HTTP_CHECK", "RESTART_SERVICE", "ROLLBACK_DEPLOYMENT", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["HEARTBEAT_MISSED", "HEARTBEAT STALE", "HEARTBEAT_STALE"])) {
    return {
      diagnosis: "Heartbeat signal is missing. The background worker or scheduled process has likely stopped or is stuck.",
      confidence: 0.88,
      category: "AVAILABILITY",
      suggestedActions: ["RESTART_WORKER", "REQUEUE_FAILED_JOB", "REQUEST_HUMAN_REVIEW"],
    };
  }

  // ── Reliability ───────────────────────────────────────────────────────────
  if (matches(signals, ["WEBHOOK_FAILED", "WEBHOOK FAIL", "WEBHOOK_SIGNATURE_FAILED"])) {
    return {
      diagnosis: "Webhook delivery is failing. The target endpoint may be down, returning errors, or rejecting the signature.",
      confidence: 0.85,
      category: "RELIABILITY",
      suggestedActions: ["RETRY_WEBHOOKS", "CHECK_PROVIDER_STATUS", "DISABLE_INTEGRATION"],
    };
  }

  if (matches(signals, ["PAYMENT_FAILED", "PAYMENT FAIL", "STRIPE", "PAYSTACK"])) {
    return {
      diagnosis: "Payment processing failures detected. The payment provider may be degraded or the integration credentials may be invalid.",
      confidence: 0.82,
      category: "RELIABILITY",
      suggestedActions: ["RETRY_PAYMENT_VERIFICATION", "CHECK_PROVIDER_STATUS", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["EMAIL_FAILED", "EMAIL FAIL", "SENDGRID", "MAILGUN", "SES"])) {
    return {
      diagnosis: "Email delivery is failing. The mail provider may be rate-limiting or experiencing degraded service.",
      confidence: 0.8,
      category: "RELIABILITY",
      suggestedActions: ["RETRY_EMAILS", "CHECK_PROVIDER_STATUS"],
    };
  }

  if (matches(signals, ["CRON_MISSED", "JOB FAILED", "QUEUE BACKED", "QUEUE_OVERFLOW"])) {
    return {
      diagnosis: "Background jobs are not completing. The queue may be backed up or the worker process is stalled.",
      confidence: 0.78,
      category: "RELIABILITY",
      suggestedActions: ["REQUEUE_FAILED_JOB", "RESTART_WORKER", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["BOOKING_FAILED", "ORDER_FAILED", "RESERVATION FAIL"])) {
    return {
      diagnosis: "Business operation failures detected. Downstream service dependencies (database, payment, third-party API) may be unavailable.",
      confidence: 0.75,
      category: "RELIABILITY",
      suggestedActions: ["REQUEUE_FAILED_JOB", "REQUEST_HUMAN_REVIEW"],
    };
  }

  // ── Performance ───────────────────────────────────────────────────────────
  if (matches(signals, ["RESPONSE_TIME", "LATENCY", "TIMEOUT", "SLOW", "DEGRADED"])) {
    return {
      diagnosis: "Response times are elevated. The service may be under heavy load or a downstream dependency is slow.",
      confidence: 0.72,
      category: "PERFORMANCE",
      suggestedActions: ["RERUN_HTTP_CHECK", "REQUEST_HUMAN_REVIEW"],
    };
  }

  // ── Security ──────────────────────────────────────────────────────────────
  if (matches(signals, ["AUTH_FAILURE_SPIKE", "AUTH_SPIKE", "BRUTE", "FAILED LOGIN", "401", "403"])) {
    return {
      diagnosis: "Spike in authentication failures detected. This may indicate a brute-force or credential-stuffing attack.",
      confidence: 0.84,
      category: "SECURITY",
      suggestedActions: ["REQUEST_HUMAN_REVIEW", "DISABLE_INTEGRATION"],
    };
  }

  if (matches(signals, ["TRAFFIC_SPIKE", "REQUEST SPIKE", "429", "RATE LIMIT", "HAMMERED"])) {
    return {
      diagnosis: "Abnormal traffic volume detected. A bot, scraper, or DDoS may be targeting this endpoint.",
      confidence: 0.8,
      category: "SECURITY",
      suggestedActions: ["REQUEST_HUMAN_REVIEW"],
    };
  }

  // ── Dependency / Change ───────────────────────────────────────────────────
  if (matches(signals, ["DEPLOY_FAILED", "DEPLOYMENT FAIL", "BUILD FAIL", "GITHUB ACTION FAIL"])) {
    return {
      diagnosis: "Deployment pipeline has failed. The last deployment did not complete successfully.",
      confidence: 0.87,
      category: "DEPENDENCY_CHANGE",
      suggestedActions: ["ROLLBACK_DEPLOYMENT", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["SSL_EXPIRING", "SSL EXPIR", "CERTIFICATE"])) {
    return {
      diagnosis: "SSL certificate is approaching expiry. Renew it before the deadline to prevent HTTPS failures.",
      confidence: 0.95,
      category: "DEPENDENCY_CHANGE",
      suggestedActions: ["RERUN_SSL_CHECK", "ADD_INCIDENT_NOTE", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["DOMAIN_EXPIRING", "DOMAIN EXPIR"])) {
    return {
      diagnosis: "Domain registration is approaching expiry. Renew the domain to prevent DNS resolution failures.",
      confidence: 0.95,
      category: "DEPENDENCY_CHANGE",
      suggestedActions: ["ADD_INCIDENT_NOTE", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["GOOGLE_API_FAILED", "THIRD_PARTY", "PROVIDER OUTAGE", "PROVIDER DOWN"])) {
    return {
      diagnosis: "A third-party provider dependency is failing. Check the provider's status page.",
      confidence: 0.7,
      category: "DEPENDENCY_CHANGE",
      suggestedActions: ["CHECK_PROVIDER_STATUS", "REQUEST_HUMAN_REVIEW"],
    };
  }

  // ── Default / Unknown ─────────────────────────────────────────────────────
  return {
    diagnosis: "Insufficient signal to provide a specific diagnosis. Review recent events and logs for the affected service.",
    confidence: 0.3,
    category: "AVAILABILITY",
    suggestedActions: [],
  };
}

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}
