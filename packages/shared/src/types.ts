import {
	AlertSeverity,
	CheckStatus,
	CheckType,
	EventType,
	ProjectStatus,
	ServiceType
} from "./enums";

export type UUID = string;

export interface ProjectSummary {
	id: UUID;
	name: string;
	slug: string;
	clientName: string;
	environment: string;
	status: ProjectStatus;
}

export interface HeartbeatPayload {
	projectSlug: string;
	environment: string;
	status: ProjectStatus;
	commitSha?: string;
	appVersion?: string;
	message?: string;
	payload?: Record<string, unknown>;
}

export interface EventPayload {
	projectSlug: string;
	type: EventType;
	severity: AlertSeverity;
	source: string;
	message: string;
	serviceId?: UUID;
	fingerprint?: string;
	payload?: Record<string, unknown>;
}

export interface HealthSnapshot {
	appName: string;
	environment: string;
	version: string;
	commitSha?: string;
	uptimeSeconds: number;
	databaseConnected: boolean;
	timestamp: string;
}

export interface CheckRunResult {
	checkId: UUID;
	type: CheckType;
	status: CheckStatus;
	responseCode?: number;
	responseTimeMs?: number;
	message?: string;
}

export interface ServiceSummary {
	id: UUID;
	projectId: UUID;
	name: string;
	type: ServiceType;
	status: ProjectStatus;
	baseUrl?: string;
}
