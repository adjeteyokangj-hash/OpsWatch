import dotenv from "dotenv";

dotenv.config();

const required = (value: string | undefined, key: string): string => {
	if (!value) {
		throw new Error(`Missing environment variable: ${key}`);
	}
	return value;
};

export const env = {
	nodeEnv: process.env.NODE_ENV || "development",
	port: Number(process.env.PORT || 4000),
	databaseUrl: required(process.env.DATABASE_URL, "DATABASE_URL"),
	jwtSecret: required(process.env.JWT_SECRET, "JWT_SECRET"),
	webUrl:
		process.env.OPSWATCH_WEB_URL ||
		(process.env.NODE_ENV === "production" ? "https://ops-watch-web.vercel.app" : "http://localhost:3000"),
	smtpHost: process.env.SMTP_HOST,
	smtpPort: Number(process.env.SMTP_PORT || 587),
	smtpUser: process.env.SMTP_USER,
	smtpPass: process.env.SMTP_PASS,
	smtpFrom: process.env.SMTP_FROM || "alerts@opswatch.local",
	workerRestartWebhookUrl: process.env.WORKER_RESTART_WEBHOOK_URL,
	serviceRestartWebhookUrl: process.env.SERVICE_RESTART_WEBHOOK_URL,
	deploymentRollbackWebhookUrl: process.env.DEPLOYMENT_ROLLBACK_WEBHOOK_URL,
	paymentVerificationEndpoint: process.env.PAYMENT_VERIFICATION_ENDPOINT,
	jobRequeueEndpoint: process.env.JOB_REQUEUE_ENDPOINT,
	providerStatusUrl: process.env.PROVIDER_STATUS_URL,
	runbookBaseUrl: process.env.RUNBOOK_BASE_URL
};
