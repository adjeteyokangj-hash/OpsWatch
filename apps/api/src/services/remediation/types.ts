export type RemediationExecutionStatus =
  | "COMPLETED"
  | "FAILED"
  | "PENDING_APPROVAL"
  | "UNSUPPORTED"
  /** Action is wired but required context fields are absent (e.g. no integrationId). */
  | "MISSING_CONTEXT"
  /** Action is wired but the environment/provider is not configured (missing env vars). */
  | "MISCONFIGURED_ENV";

export interface RemediationExecutionResult {
  success: boolean;
  status: RemediationExecutionStatus;
  summary: string;
  details?: Record<string, unknown>;
  /** For MISSING_CONTEXT: the field names that are absent. */
  missingFields?: string[];
  /** For MISCONFIGURED_ENV: the env var names that are not set. */
  missingEnvVars?: string[];
}

export interface RemediationContext {
  organizationId: string;
  projectId?: string;
  serviceId?: string;
  checkId?: string;
  alertId?: string;
  incidentId?: string;
  note?: string;
  integrationId?: string;
  limit?: number;
  extra?: Record<string, unknown>;
}

export interface RemediationExecutorInput {
  context: RemediationContext;
  executedBy?: string;
}

export type RemediationExecutor = (
  input: RemediationExecutorInput
) => Promise<RemediationExecutionResult>;
