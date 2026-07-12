export type FailureClass =
  | "NETWORK_UNREACHABLE"
  | "CONNECTION_REFUSED"
  | "TIMEOUT"
  | "DNS_FAILURE"
  | "TLS_FAILURE"
  | "HTTP_STATUS_MISMATCH"
  | "APPLICATION_ERROR"
  | "AUTHENTICATION"
  | "KEYWORD_MISMATCH"
  | "LATENCY_THRESHOLD"
  | "UNKNOWN";

export interface FailureClassification {
  failureClass: FailureClass;
  category: "AVAILABILITY" | "RELIABILITY" | "PERFORMANCE" | "SECURITY" | "DEPENDENCY_CHANGE";
  diagnosis: string;
  confidence: number;
  possibleCauses: string[];
  expectedStatusCode?: number;
  actualStatusCode?: number;
  detail?: string;
}

const statusMismatchDiagnosis = (
  expected: number,
  actual: number
): FailureClassification => {
  if (actual === 401 || actual === 403) {
    return {
      failureClass: "AUTHENTICATION",
      category: "SECURITY",
      diagnosis:
        "Endpoint requires authentication or credentials are invalid.",
      confidence: 0.93,
      possibleCauses: [
        "Missing or expired auth token",
        "Incorrect API key or credentials",
        "Route protected but health check is unauthenticated"
      ],
      expectedStatusCode: expected,
      actualStatusCode: actual
    };
  }

  if (actual >= 500) {
    return {
      failureClass: "APPLICATION_ERROR",
      category: "RELIABILITY",
      diagnosis: "Application is reachable but returning server errors.",
      confidence: 0.92,
      possibleCauses: [
        "Unhandled exception in application code",
        "Downstream dependency failure inside the app",
        "Database or cache connectivity issue",
        "Recent deployment introduced a regression"
      ],
      expectedStatusCode: expected,
      actualStatusCode: actual
    };
  }

  if (actual >= 200 && actual < 300 && expected >= 400) {
    return {
      failureClass: "HTTP_STATUS_MISMATCH",
      category: "RELIABILITY",
      diagnosis:
        "Endpoint responded successfully but returned an unexpected status code.",
      confidence: 0.95,
      possibleCauses: [
        "Deployment completed and service recovered",
        "Health check expectation is misconfigured",
        "Wrong expected status configured for this environment"
      ],
      expectedStatusCode: expected,
      actualStatusCode: actual,
      detail: `Expected ${expected}, received ${actual}.`
    };
  }

  return {
    failureClass: "HTTP_STATUS_MISMATCH",
    category: "RELIABILITY",
    diagnosis: "Endpoint is reachable but returned an unexpected HTTP status code.",
    confidence: 0.9,
    possibleCauses: [
      "Routing or load balancer returning unexpected responses",
      "Canary or blue/green deployment in progress",
      "Health check expectation mismatch"
    ],
    expectedStatusCode: expected,
    actualStatusCode: actual,
    detail: `Expected ${expected}, received ${actual}.`
  };
};

const networkDiagnosis = (causeText: string): FailureClassification => {
  const upper = causeText.toUpperCase();

  if (upper.includes("ENOTFOUND") || upper.includes("EAI_AGAIN") || upper.includes("DNS")) {
    return {
      failureClass: "DNS_FAILURE",
      category: "AVAILABILITY",
      diagnosis: "Endpoint hostname could not be resolved.",
      confidence: 0.94,
      possibleCauses: [
        "DNS record missing or expired",
        "Wrong hostname configured on the check",
        "Private DNS not reachable from the worker"
      ],
      detail: causeText
    };
  }

  if (upper.includes("ECONNREFUSED")) {
    return {
      failureClass: "CONNECTION_REFUSED",
      category: "AVAILABILITY",
      diagnosis: "Endpoint refused the connection.",
      confidence: 0.93,
      possibleCauses: [
        "Service process is not listening on the target port",
        "Firewall or security group blocking traffic",
        "Container or host is down"
      ],
      detail: causeText
    };
  }

  if (upper.includes("ETIMEDOUT") || upper.includes("TIMEOUT") || upper.includes("ABORT")) {
    return {
      failureClass: "TIMEOUT",
      category: "PERFORMANCE",
      diagnosis: "Endpoint did not respond before the check timeout.",
      confidence: 0.91,
      possibleCauses: [
        "Service is overloaded or hung",
        "Network latency or packet loss",
        "Timeout threshold is too aggressive"
      ],
      detail: causeText
    };
  }

  if (
    upper.includes("CERT") ||
    upper.includes("TLS") ||
    upper.includes("SSL") ||
    upper.includes("UNABLE_TO_VERIFY")
  ) {
    return {
      failureClass: "TLS_FAILURE",
      category: "AVAILABILITY",
      diagnosis: "TLS handshake or certificate validation failed.",
      confidence: 0.94,
      possibleCauses: [
        "Expired or mis-issued certificate",
        "Hostname mismatch on certificate",
        "Incomplete certificate chain"
      ],
      detail: causeText
    };
  }

  return {
    failureClass: "NETWORK_UNREACHABLE",
    category: "AVAILABILITY",
    diagnosis: "Endpoint is unreachable from the monitoring worker.",
    confidence: 0.9,
    possibleCauses: [
      "Host is down or not routable",
      "Outbound network path blocked",
      "Incorrect URL or port configured"
    ],
    detail: causeText
  };
};

const parseExpectedActual = (
  message: string
): { expected: number; actual: number } | null => {
  const match = message.match(/Expected\s+(\d{3})\s+got\s+(\d{3})/i);
  if (!match) return null;
  return { expected: Number(match[1]), actual: Number(match[2]) };
};

export const classifyHttpCheckFailure = (input: {
  checkType?: string;
  expectedStatusCode?: number | null;
  actualStatusCode?: number | null;
  message?: string;
  error?: unknown;
}): FailureClassification => {
  const parsed = input.message ? parseExpectedActual(input.message) : null;
  const expected = input.expectedStatusCode ?? parsed?.expected;
  const actual = input.actualStatusCode ?? parsed?.actual;

  if (typeof expected === "number" && typeof actual === "number" && expected !== actual) {
    return statusMismatchDiagnosis(expected, actual);
  }

  if (input.checkType === "RESPONSE_TIME" || /response time.*exceeds/i.test(input.message ?? "")) {
    return {
      failureClass: "LATENCY_THRESHOLD",
      category: "PERFORMANCE",
      diagnosis: "Endpoint responded but exceeded the configured latency threshold.",
      confidence: 0.88,
      possibleCauses: [
        "Service under load",
        "Slow downstream dependency",
        "Latency threshold too strict for environment"
      ],
      detail: input.message
    };
  }

  if (input.checkType === "KEYWORD" || /keyword.*not found/i.test(input.message ?? "")) {
    return {
      failureClass: "KEYWORD_MISMATCH",
      category: "RELIABILITY",
      diagnosis: "Endpoint responded but the expected response body marker was missing.",
      confidence: 0.9,
      possibleCauses: [
        "Application returned an unexpected payload",
        "Feature flag or deployment changed response shape",
        "Keyword expectation is outdated"
      ],
      detail: input.message
    };
  }

  if (input.error) {
    const cause =
      input.error instanceof Error && "cause" in input.error
        ? String((input.error.cause as { code?: string; message?: string })?.code ||
            (input.error.cause as { message?: string })?.message ||
            input.error.message)
        : input.error instanceof Error
          ? input.error.message
          : String(input.error);
    return networkDiagnosis(cause);
  }

  if (/HTTP request failed/i.test(input.message ?? "")) {
    return networkDiagnosis(input.message ?? "Network failure");
  }

  return {
    failureClass: "UNKNOWN",
    category: "AVAILABILITY",
    diagnosis: "Check failed without enough signal to classify the failure type.",
    confidence: 0.35,
    possibleCauses: ["Review recent check results and logs"],
    detail: input.message
  };
};

export const formatFailureMessage = (classification: FailureClassification): string => {
  const parts = [
    `[${classification.failureClass}]`,
    classification.detail ?? classification.diagnosis
  ].filter(Boolean);
  return parts.join(" ");
};

export const failureClassSignal = (classification: FailureClassification): string =>
  classification.failureClass;
