export const HEARTBEAT_INTERVAL_SECONDS = 300;
export const STALE_HEARTBEAT_WARN_MINUTES = 10;
export const STALE_HEARTBEAT_HIGH_MINUTES = 20;

export const HTTP_ALERT_RULES = {
	warnAt: 1,
	highAt: 3,
	criticalAt: 5
} as const;
