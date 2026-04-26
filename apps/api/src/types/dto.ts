/**
 * Explicit Data Transfer Object types for all list and detail endpoints.
 * These are the stable frontend contracts — decouple the API response shape from
 * the Prisma model shape so schema changes don't silently break callers.
 */

// ─── Shared primitives ───────────────────────────────────────────────────────

export type ProjectRefDto = {
  id: string;
  name: string;
};

export type ServiceRefDto = {
  id: string;
  name: string;
};

export type UserRefDto = {
  id: string;
  name: string;
  email: string;
};

// ─── Alert DTOs ──────────────────────────────────────────────────────────────

export type AlertListItemDto = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  category: string;
  sourceType: string;
  firstSeenAt: string;
  lastSeenAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  project: ProjectRefDto;
  service: ServiceRefDto | null;
};

export type IncidentRefDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
};

export type AlertDetailDto = AlertListItemDto & {
  assignedTo: UserRefDto | null;
  incidents: IncidentRefDto[];
};

// ─── Incident DTOs ───────────────────────────────────────────────────────────

export type IncidentListItemDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  project: ProjectRefDto;
};

export type AlertRefDto = {
  id: string;
  title: string;
  severity: string;
  status: string;
  lastSeenAt: string;
  service: ServiceRefDto | null;
};

export type IncidentDetailDto = IncidentListItemDto & {
  rootCause: string | null;
  resolutionNotes: string | null;
  alerts: AlertRefDto[];
};

// ─── Check DTOs ──────────────────────────────────────────────────────────────

export type CheckResultDto = {
  id: string;
  status: string;
  responseCode: number | null;
  responseTimeMs: number | null;
  message: string | null;
  checkedAt: string;
};

export type CheckListItemDto = {
  id: string;
  name: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  isActive: boolean;
  service: ServiceRefDto & { project: ProjectRefDto };
  latestResult: CheckResultDto | null;
};

export type CheckStatusSummaryDto = {
  total: number;
  pass: number;
  fail: number;
  warn: number;
  pending: number;
};

export type CheckListResponseDto = {
  items: CheckListItemDto[];
  summary: CheckStatusSummaryDto;
};

export type CheckDetailDto = {
  id: string;
  name: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatusCode: number | null;
  expectedKeyword: string | null;
  failureThreshold: number;
  recoveryThreshold: number;
  configJson: unknown;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  service: ServiceRefDto & { project: ProjectRefDto };
  latestResult: CheckResultDto | null;
  recentResults: CheckResultDto[];
  statusSummary: CheckStatusSummaryDto;
};
