import { EventPayload } from "@opswatch/shared";
import { createSignature } from "./signatures";
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
	const signature = createSignature(payload, timestamp, config.signingSecret);

	const response = await fetch(`${config.baseUrl}/api/ingest/event`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-opswatch-project-key": config.projectKey,
			"x-opswatch-timestamp": timestamp,
			"x-opswatch-signature": signature,
			"x-opswatch-environment": config.environment
		},
		body: JSON.stringify(payload)
	});

	await assertOk(response);
};
