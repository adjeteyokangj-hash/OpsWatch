import type { RemediationAction } from "../remediation/actions";

export type PlaybookAction =
  | "RERUN_CHECK"
  | "VERIFY_SERVICE"
  | "REVIEW_HTTP_EXPECTED_STATUS"
  | "RETRY_WEBHOOKS"
  | "RETRY_EMAILS"
  | "REQUEUE_FAILED_JOB"
  | "CHECK_PROVIDER_STATUS"
  | "ACKNOWLEDGE_INCIDENT"
  | "ADD_INCIDENT_NOTE"
  | "REQUEST_HUMAN_REVIEW";

const DIRECT_MAP: Record<string, RemediationAction> = {
  REVIEW_HTTP_EXPECTED_STATUS: "REVIEW_HTTP_EXPECTED_STATUS",
  RETRY_WEBHOOKS: "RETRY_WEBHOOKS",
  RETRY_EMAILS: "RETRY_EMAILS",
  REQUEUE_FAILED_JOB: "REQUEUE_FAILED_JOB",
  CHECK_PROVIDER_STATUS: "CHECK_PROVIDER_STATUS",
  ACKNOWLEDGE_INCIDENT: "ACKNOWLEDGE_INCIDENT",
  ADD_INCIDENT_NOTE: "ADD_INCIDENT_NOTE",
  REQUEST_HUMAN_REVIEW: "REQUEST_HUMAN_REVIEW"
};

export const mapPlaybookActionToRemediation = (action: string): RemediationAction | null => {
  if (action === "RERUN_CHECK" || action === "VERIFY_SERVICE") {
    return "RERUN_HTTP_CHECK";
  }
  return DIRECT_MAP[action] ?? null;
};

export const isSkippableOnFailure = (action: string): boolean => action === "REQUEST_HUMAN_REVIEW";
