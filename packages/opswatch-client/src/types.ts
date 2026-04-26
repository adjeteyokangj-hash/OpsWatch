import { EventPayload, HeartbeatPayload, HealthSnapshot } from "@opswatch/shared";

export interface OpsWatchClientConfig {
	baseUrl: string;
	projectKey: string;
	signingSecret: string;
	environment: string;
	appName: string;
	appVersion?: string;
	projectSlug?: string;
}

export type SendHeartbeatInput = Omit<HeartbeatPayload, "environment" | "projectSlug"> & {
	environment?: string;
	projectSlug?: string;
};

export type SendEventInput = Omit<EventPayload, "projectSlug" | "source"> & {
	projectSlug?: string;
	source?: string;
};

export type BuildHealthInput = Omit<HealthSnapshot, "timestamp">;
