import { createHmac, randomUUID } from "crypto";
import { HeartbeatPayload } from "@opswatch/shared";
import { OpsWatchClientConfig, SendHeartbeatInput } from "./types";

const assertOk = async (response: Response): Promise<void> => {
	if (response.ok) {
		return;
	}

	const body = await response.text();
	throw new Error(`OpsWatch heartbeat failed: ${response.status} ${body}`);
};

export const sendHeartbeat = async (
	config: OpsWatchClientConfig,
	input: SendHeartbeatInput
): Promise<void> => {
	const payload: HeartbeatPayload = {
		...input,
		projectSlug: input.projectSlug || config.projectSlug || config.projectKey,
		appVersion: input.appVersion || config.appVersion,
		environment: input.environment || config.environment
	};

	const timestamp = new Date().toISOString();
	const nonce = randomUUID();
	const body = JSON.stringify(payload);
	const signature = createHmac("sha256", config.signingSecret)
		.update(`${timestamp}.${nonce}.${body}`)
		.digest("hex");

	const response = await fetch(`${config.baseUrl}/api/ingest/heartbeat`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-opswatch-project-key": config.projectKey,
			"x-opswatch-timestamp": timestamp,
			"x-opswatch-nonce": nonce,
			"x-opswatch-signature": signature,
			"x-opswatch-environment": payload.environment || config.environment
		},
		body
	});

	await assertOk(response);
};
