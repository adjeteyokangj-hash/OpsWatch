import { OpsWatchClientConfig } from "./types";

const required = (value: string | undefined, key: string): string => {
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`);
	}
	return value;
};

export const loadConfigFromEnv = (): OpsWatchClientConfig => {
	return {
		baseUrl: required(process.env.OPSWATCH_BASE_URL, "OPSWATCH_BASE_URL"),
		projectKey: required(process.env.OPSWATCH_PROJECT_KEY, "OPSWATCH_PROJECT_KEY"),
		signingSecret: required(process.env.OPSWATCH_SIGNING_SECRET, "OPSWATCH_SIGNING_SECRET"),
		environment: process.env.OPSWATCH_ENV || "production",
		appName: required(process.env.OPSWATCH_APP_NAME, "OPSWATCH_APP_NAME"),
		appVersion: process.env.OPSWATCH_APP_VERSION
	};
};
