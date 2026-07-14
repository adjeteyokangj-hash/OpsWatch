export type TopologyFailureKind = "timeout" | "unavailable" | "auth" | "generic";

export type ClassifiedTopologyError = {
  kind: TopologyFailureKind;
  title: string;
  explanation: string;
  /** Raw message / stack for engineers (expandable). */
  technicalDetails: string;
  invocationId: string | null;
};

const INVOCATION_ID_RE = /\b([a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12})\b/i;

/**
 * Map API / Vercel failure strings into calm operator copy.
 * Detects FUNCTION_INVOCATION_TIMEOUT, 504, gateway timeouts, and generic outages.
 */
export const classifyTopologyError = (error: unknown): ClassifiedTopologyError => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : String(error ?? "Unknown error");
  const technicalDetails = raw.trim() || "No technical details returned.";
  const invocationMatch = technicalDetails.match(INVOCATION_ID_RE);
  const invocationId = invocationMatch?.[1] ?? null;

  const isTimeout =
    /FUNCTION_INVOCATION_TIMEOUT/i.test(technicalDetails) ||
    /\b504\b/.test(technicalDetails) ||
    /gateway timeout/i.test(technicalDetails) ||
    /invocation timeout/i.test(technicalDetails) ||
    /request timed?\s*out/i.test(technicalDetails) ||
    (/timed?\s*out/i.test(technicalDetails) && !/API unreachable/i.test(technicalDetails));

  if (isTimeout) {
    return {
      kind: "timeout",
      title: "Topology refresh delayed",
      explanation:
        "The service map couldn’t be refreshed because the topology service timed out before finishing.",
      technicalDetails,
      invocationId
    };
  }

  if (/API unreachable|failed to fetch|networkerror|load failed/i.test(technicalDetails)) {
    return {
      kind: "unavailable",
      title: "Topology service unreachable",
      explanation:
        "OpsWatch couldn’t reach the topology API. Auto-refresh will keep trying.",
      technicalDetails,
      invocationId
    };
  }

  if (/\b401\b|\b403\b|unauthorized|forbidden/i.test(technicalDetails)) {
    return {
      kind: "auth",
      title: "Couldn’t refresh topology",
      explanation: "Your session may have expired, or this account lacks access to the service map.",
      technicalDetails,
      invocationId
    };
  }

  return {
    kind: "generic",
    title: "Topology data unavailable",
    explanation: "The service map couldn’t be refreshed. Auto-refresh will keep trying.",
    technicalDetails,
    invocationId
  };
};
