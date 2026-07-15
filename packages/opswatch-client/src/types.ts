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

export type OtelBridgeSignalKind = "METRIC" | "LOG" | "SPAN";

export type OtelBridgePayload = {
	resource: {
		serviceName: string;
		serviceVersion?: string;
		deploymentEnvironment?: string;
		hostName?: string;
		containerId?: string;
		attributes?: Record<string, unknown>;
	};
	signals: Array<{
		kind: OtelBridgeSignalKind;
		name: string;
		timestamp?: string;
		severity?: "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
		value?: number;
		body?: string;
		traceId?: string;
		spanId?: string;
		parentSpanId?: string;
		attributes?: Record<string, unknown>;
	}>;
};

export type OtelBridgeClientConfig = {
	baseUrl: string;
	connectionId: string;
	signingSecret: string;
};
