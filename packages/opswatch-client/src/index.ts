import { loadConfigFromEnv } from "./config";
import { sendEvent } from "./event";
import { buildHealthSnapshot } from "./health";
import { sendHeartbeat } from "./heartbeat";
import { OpsWatchClientConfig, SendEventInput, SendHeartbeatInput } from "./types";

export const createOpsWatchClient = (config: OpsWatchClientConfig = loadConfigFromEnv()) => {
	return {
		config,
		sendHeartbeat: (input: SendHeartbeatInput) => sendHeartbeat(config, input),
		sendEvent: (input: SendEventInput) => sendEvent(config, input),
		buildHealthSnapshot
	};
};

export * from "./config";
export * from "./event";
export * from "./health";
export * from "./heartbeat";
export * from "./signatures";
export * from "./types";
