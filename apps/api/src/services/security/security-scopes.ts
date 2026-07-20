export const SECURITY_API_KEY_SCOPES = [
  "security.events:write",
  "authentication.events:write",
  "audit.events:write",
  "security.findings:read",
  "security.response:request"
] as const;

export type SecurityApiKeyScope = (typeof SECURITY_API_KEY_SCOPES)[number];

export const SECURITY_WRITE_SCOPES = [
  "security.events:write",
  "authentication.events:write",
  "audit.events:write"
] as const;

export const SECURITY_FINDING_STATES = [
  "OPEN",
  "INVESTIGATING",
  "CONTAINING",
  "MONITORING",
  "RESOLVED",
  "ACCEPTED_RISK",
  "FALSE_POSITIVE",
  "SUPPRESSED"
] as const;

export type SecurityFindingState = (typeof SECURITY_FINDING_STATES)[number];

export const SECURITY_RISK_STATES = [
  "NORMAL",
  "ELEVATED_RISK",
  "ACTIVE_SUSPICIOUS",
  "CONFIRMED_COMPROMISED",
  "UNKNOWN"
] as const;

export type SecurityRiskState = (typeof SECURITY_RISK_STATES)[number];

export const ATTACK_PATH_EVIDENCE_LEVELS = [
  "CONFIRMED",
  "SUSPECTED",
  "POSSIBLE",
  "INSUFFICIENT_EVIDENCE"
] as const;

export type AttackPathEvidenceLevel = (typeof ATTACK_PATH_EVIDENCE_LEVELS)[number];

export const COVERAGE_DIMENSIONS = [
  "EXTERNAL_EXPOSURE",
  "APPLICATION_EVENTS",
  "AUTHENTICATION",
  "SOURCE_CODE",
  "CLOUD_HOSTING",
  "INFRASTRUCTURE",
  "THREAT_RESPONSE"
] as const;

export type CoverageDimension = (typeof COVERAGE_DIMENSIONS)[number];

export const COVERAGE_DEPTHS = ["NONE", "BASIC", "STANDARD", "ADVANCED", "DEEP"] as const;
export type CoverageDepth = (typeof COVERAGE_DEPTHS)[number];

export const BASELINE_WORDING = {
  ABOVE_NORMAL: "Above normal",
  OUTSIDE_PATTERN: "Outside configured operating pattern",
  THRESHOLD_EXCEEDED: "Threshold exceeded",
  INSUFFICIENT_DATA: "Insufficient baseline data"
} as const;

export const MAX_SECURITY_EVENTS_PER_BATCH = 100;
export const MAX_SECURITY_EVENT_PAYLOAD_BYTES = 32_768;
export const SECURITY_TIMESTAMP_SKEW_MS = 15 * 60 * 1000;
export const SECURITY_TIMESTAMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_SECURITY_RETENTION_DAYS = 30;
