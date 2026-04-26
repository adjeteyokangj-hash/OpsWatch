import { scheduleJobs } from "./services/scheduler.service";
import { logger } from "./lib/logger";

logger.info("OpsWatch worker starting");

let stopScheduler = scheduleJobs({ runOnStart: true });
let heartbeatTimer = setInterval(() => {
	logger.info("OpsWatch worker alive");
}, 60_000);

const shutdown = (signal: string): void => {
	logger.info(`OpsWatch worker stopping (${signal})`);
	stopScheduler();
	clearInterval(heartbeatTimer);
};

process.on("SIGINT", () => {
	shutdown("SIGINT");
	process.exit(0);
});

process.on("SIGTERM", () => {
	shutdown("SIGTERM");
	process.exit(0);
});

process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception in worker", { error: String(error) });
	shutdown("uncaughtException");
	process.exit(1);
});

process.on("unhandledRejection", (reason) => {
	logger.error("Unhandled rejection in worker", { reason: String(reason) });
});
