import { classifyHttpCheckFailure, type FailureClassification } from "@opswatch/shared";
import { RemediationAction } from "../remediation/actions";

export interface DiagnosisInput {
  alertType?: string;
  eventTypes?: string[];
  severity?: string;
  serviceType?: string;
  title?: string;
  message?: string;
  failureClass?: string;
  expectedStatusCode?: number;
  actualStatusCode?: number;
}

export interface DiagnosisOutput {
  diagnosis: string;
  confidence: number;
  suggestedActions: RemediationAction[];
  category: string;
  failureClass?: string;
  possibleCauses?: string[];
}

const actionsForFailure = (classification: FailureClassification): RemediationAction[] => {
  switch (classification.failureClass) {
    case "HTTP_STATUS_MISMATCH":
      return ["RERUN_HTTP_CHECK", "REVIEW_HTTP_EXPECTED_STATUS", "ADD_INCIDENT_NOTE", "REQUEST_HUMAN_REVIEW"];
    case "APPLICATION_ERROR":
      return ["RERUN_HTTP_CHECK", "RESTART_SERVICE", "ROLLBACK_DEPLOYMENT", "REQUEST_HUMAN_REVIEW"];
    case "AUTHENTICATION":
      return ["ADD_INCIDENT_NOTE", "RERUN_HTTP_CHECK", "REQUEST_HUMAN_REVIEW"];
    case "NETWORK_UNREACHABLE":
    case "CONNECTION_REFUSED":
    case "DNS_FAILURE":
    case "TLS_FAILURE":
      // Check-oriented first — never default to webhook/email retries for connectivity failures.
      return ["RERUN_HTTP_CHECK", "TEST_CONNECTION", "CHECK_PROVIDER_STATUS", "REQUEST_HUMAN_REVIEW"];
    case "TIMEOUT":
      return ["RERUN_HTTP_CHECK", "REQUEST_HUMAN_REVIEW"];
    case "KEYWORD_MISMATCH":
      return ["RERUN_HTTP_CHECK", "ADD_INCIDENT_NOTE", "REQUEST_HUMAN_REVIEW"];
    case "LATENCY_THRESHOLD":
      return ["RERUN_HTTP_CHECK", "REQUEST_HUMAN_REVIEW"];
    default:
      return ["RERUN_HTTP_CHECK", "REQUEST_HUMAN_REVIEW"];
  }
};

const diagnosisFromClassification = (classification: FailureClassification): DiagnosisOutput => ({
  diagnosis: classification.diagnosis,
  confidence: classification.confidence,
  category: classification.category,
  suggestedActions: actionsForFailure(classification),
  failureClass: classification.failureClass,
  possibleCauses: classification.possibleCauses
});

const tryClassifyCheckFailure = (input: DiagnosisInput): DiagnosisOutput | null => {
  const classification = classifyHttpCheckFailure({
    checkType: input.alertType,
    expectedStatusCode: input.expectedStatusCode,
    actualStatusCode: input.actualStatusCode,
    message: input.message
  });

  if (classification.failureClass === "UNKNOWN") {
    return null;
  }

  return diagnosisFromClassification(classification);
};

/**
 * Rule-based diagnosis engine with precise HTTP/network failure classification.
 */
export function diagnose(input: DiagnosisInput): DiagnosisOutput {
  const classified = tryClassifyCheckFailure(input);
  if (classified) {
    return classified;
  }

  const signals = [
    input.failureClass?.toUpperCase() ?? "",
    input.alertType?.toUpperCase() ?? "",
    ...(input.eventTypes ?? []).map((t) => t.toUpperCase()),
    input.title?.toUpperCase() ?? "",
    input.message?.toUpperCase() ?? "",
  ].join(" ");

  if (matches(signals, ["HTTP_STATUS_MISMATCH"])) {
    return diagnosisFromClassification(
      classifyHttpCheckFailure({
        message: input.message,
        expectedStatusCode: input.expectedStatusCode,
        actualStatusCode: input.actualStatusCode
      })
    );
  }

  if (matches(signals, ["APPLICATION_ERROR"])) {
    return diagnosisFromClassification(
      classifyHttpCheckFailure({
        expectedStatusCode: input.expectedStatusCode ?? 200,
        actualStatusCode: input.actualStatusCode ?? 500
      })
    );
  }

  if (matches(signals, ["HEARTBEAT_MISSED", "HEARTBEAT STALE", "HEARTBEAT_STALE"])) {
    return {
      diagnosis: "Heartbeat signal is missing. The background worker or scheduled process has likely stopped or is stuck.",
      confidence: 0.88,
      category: "AVAILABILITY",
      suggestedActions: ["RESTART_WORKER", "REQUEUE_FAILED_JOB", "REQUEST_HUMAN_REVIEW"],
    };
  }

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

  if (matches(signals, ["RESPONSE_TIME", "LATENCY", "SLOW", "DEGRADED", "LATENCY_THRESHOLD"])) {
    return diagnosisFromClassification(
      classifyHttpCheckFailure({ checkType: "RESPONSE_TIME", message: input.message })
    );
  }

  if (matches(signals, ["TIMEOUT"])) {
    return diagnosisFromClassification(classifyHttpCheckFailure({ error: new Error("timeout") }));
  }

  if (matches(signals, ["AUTH_FAILURE_SPIKE", "AUTH_SPIKE", "BRUTE", "FAILED LOGIN", "AUTHENTICATION"])) {
    return diagnosisFromClassification(
      classifyHttpCheckFailure({ expectedStatusCode: 200, actualStatusCode: 401 })
    );
  }

  if (matches(signals, ["TRAFFIC_SPIKE", "REQUEST SPIKE", "429", "RATE LIMIT", "HAMMERED"])) {
    return {
      diagnosis: "Abnormal traffic volume detected. A bot, scraper, or DDoS may be targeting this endpoint.",
      confidence: 0.8,
      category: "SECURITY",
      suggestedActions: ["REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["DEPLOY_FAILED", "DEPLOYMENT FAIL", "BUILD FAIL", "GITHUB ACTION FAIL"])) {
    return {
      diagnosis: "Deployment pipeline has failed. The last deployment did not complete successfully.",
      confidence: 0.87,
      category: "DEPENDENCY_CHANGE",
      suggestedActions: ["ROLLBACK_DEPLOYMENT", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["SSL_EXPIRING", "SSL EXPIR", "CERTIFICATE", "TLS_FAILURE"])) {
    return {
      diagnosis: "SSL certificate is approaching expiry or TLS validation failed. Renew or fix the certificate chain before HTTPS failures spread.",
      confidence: 0.95,
      category: "DEPENDENCY_CHANGE",
      suggestedActions: ["RERUN_SSL_CHECK", "ADD_INCIDENT_NOTE", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["DOMAIN_EXPIRING", "DOMAIN EXPIR", "DNS_FAILURE"])) {
    return diagnosisFromClassification(classifyHttpCheckFailure({ error: Object.assign(new Error("dns"), { cause: { code: "ENOTFOUND" } }) }));
  }

  if (matches(signals, ["GOOGLE_API_FAILED", "THIRD_PARTY", "PROVIDER OUTAGE", "PROVIDER DOWN"])) {
    return {
      diagnosis: "A third-party provider dependency is failing. Check the provider's status page.",
      confidence: 0.7,
      category: "DEPENDENCY_CHANGE",
      suggestedActions: ["CHECK_PROVIDER_STATUS", "REQUEST_HUMAN_REVIEW"],
    };
  }

  if (matches(signals, ["SERVICE_DOWN", "DOWN", "HTTP_FAIL", "UNREACHABLE", "NOT RESPONDING", "CONNECTION_REFUSED", "NETWORK_UNREACHABLE"])) {
    return diagnosisFromClassification(
      classifyHttpCheckFailure({ message: input.message, error: new Error(input.message || "unreachable") })
    );
  }

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
