import { HealthSnapshot } from "@opswatch/shared";
import { BuildHealthInput } from "./types";

export const buildHealthSnapshot = (input: BuildHealthInput): HealthSnapshot => {
	return {
		...input,
		timestamp: new Date().toISOString()
	};
};
