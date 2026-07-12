import { createHmac, randomUUID } from "crypto";
import { EventPayload } from "@opswatch/shared";
import { resolveApiBaseUrl } from "./api-base";
import { OpsWatchClientConfig, SendEventInput } from "./types";

const assertOk = async (response: Response): Promise<void> => {
	if (response.ok) {
		return;
	}

	const body = await response.text();
	throw new Error(`OpsWatch event failed: ${response.status} ${body}`);
};

export const sendEvent = async (
	config: OpsWatchClientConfig,
	input: SendEventInput
): Promise<void> => {
	const payload: EventPayload = {
		...input,
		projectSlug: input.projectSlug || config.projectSlug || config.projectKey,
		source: input.source || config.appName
	};

	const timestamp = new Date().toISOString();
	const nonce = randomUUID();
	const body = JSON.stringify(payload);
	const signature = createHmac("sha256", config.signingSecret)
		.update(`${timestamp}.${nonce}.${body}`)
		.digest("hex");

	const response = await fetch(`${resolveApiBaseUrl(config.baseUrl)}/event`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": config.projectKey,
			"x-opswatch-timestamp": timestamp,
			"x-opswatch-nonce": nonce,
			"x-opswatch-signature": signature,
			"x-opswatch-environment": config.environment
		},
		body
	});

	await assertOk(response);
};
