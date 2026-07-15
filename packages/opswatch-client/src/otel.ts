import { randomUUID } from "crypto";
import { resolveApiBaseUrl } from "./api-base";
import { createIngestSigningHeaders } from "./signatures";
import type { OtelBridgeClientConfig, OtelBridgePayload } from "./types";

export type OtelBridgeResponse = {
	accepted: true;
	signalsAccepted: number;
	entityId: string;
};

/**
 * Sends the normalized Collector bridge contract. This is intentionally not an
 * OTLP exporter and does not expose an OTLP receiver.
 */
export const sendOtelBridgePayload = async (
	config: OtelBridgeClientConfig,
	payload: OtelBridgePayload,
	nonce = randomUUID()
): Promise<OtelBridgeResponse> => {
	const body = JSON.stringify(payload);
	const response = await fetch(
		`${resolveApiBaseUrl(config.baseUrl)}/internal/otel/v1/bridge/connections/${encodeURIComponent(config.connectionId)}`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...createIngestSigningHeaders(body, config.signingSecret, new Date().toISOString(), nonce)
			},
			body
		}
	);
	if (!response.ok) {
		throw new Error(`OpsWatch OpenTelemetry bridge failed: ${response.status} ${await response.text()}`);
	}
	return response.json() as Promise<OtelBridgeResponse>;
};
