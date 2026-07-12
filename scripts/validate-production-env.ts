import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  isPlaceholderSecret,
  isValidEmail,
  isValidHttpUrl,
  loadServiceEnv,
  redactValue,
  type EnvMap
} from "./lib/env-utils";

type ServiceName = "api" | "worker" | "web";
type Result = "PASS" | "FAIL" | "WARN" | "N/A";

type Row = {
  variable: string;
  services: ServiceName[];
  configured: "yes" | "no" | "partial";
  result: Result;
  notes: string;
  sample?: string;
};

const rootDir = path.resolve(__dirname, "..");
const strictProduction = process.argv.includes("--strict-production");
const fileEnv = loadServiceEnv(rootDir);

const get = (service: ServiceName, key: string): string | undefined =>
  process.env[key]?.trim() || fileEnv[service][key]?.trim() || undefined;

const mergeApiWorker = (key: string): { api?: string; worker?: string } => ({
  api: get("api", key),
  worker: get("worker", key)
});

const rows: Row[] = [];

const push = (row: Row) => rows.push(row);

const evaluateSecret = (input: {
  variable: string;
  services: ServiceName[];
  api?: string;
  worker?: string;
  web?: string;
  minLength?: number;
  required?: boolean;
}): void => {
  const values = [input.api, input.worker, input.web].filter(Boolean) as string[];
  const configured = values.length === 0 ? "no" : values.length === input.services.length ? "yes" : "partial";
  const weak = values.some((value) => isPlaceholderSecret(value) || (input.minLength ? value.length < input.minLength : false));
  let result: Result = "PASS";
  let notes = "Present and non-placeholder";

  if (configured === "no") {
    result = input.required === false ? "N/A" : "FAIL";
    notes = input.required === false ? "Not required for current deployment" : "Missing";
  } else if (weak) {
    result = strictProduction ? "FAIL" : "WARN";
    notes = strictProduction
      ? "Placeholder, default, or below minimum length"
      : "Development/staging value detected — rotate before public production";
  }

  push({
    variable: input.variable,
    services: input.services,
    configured,
    result,
    notes,
    sample: redactValue(values[0], true)
  });
};

const evaluateUrl = (input: {
  variable: string;
  services: ServiceName[];
  value?: string;
  required?: boolean;
  allowLocalhost?: boolean;
}): void => {
  const configured = input.value ? "yes" : "no";
  let result: Result = "PASS";
  let notes = "Valid URL configured";

  if (!input.value) {
    result = input.required ? "FAIL" : "N/A";
    notes = input.required ? "Missing URL" : "Optional for this deployment";
  } else if (!isValidHttpUrl(input.value)) {
    result = "FAIL";
    notes = "Invalid URL";
  } else if (
    strictProduction &&
    !input.allowLocalhost &&
    /localhost|127\.0\.0\.1/.test(input.value)
  ) {
    result = "FAIL";
    notes = "Localhost URL not allowed in strict production mode";
  }

  push({
    variable: input.variable,
    services: input.services,
    configured,
    result,
    notes,
    sample: input.value ? redactValue(input.value) : undefined
  });
};

const main = async (): Promise<void> => {
  const jwt = get("api", "JWT_SECRET");
  const workerSecret = mergeApiWorker("WORKER_INTERNAL_SECRET");
  const seedPassword = get("api", "SEED_ADMIN_PASSWORD");
  const approvers = get("api", "PLATFORM_PLAYBOOK_APPROVER_EMAILS");
  const databaseUrl = mergeApiWorker("DATABASE_URL");
  const webUrl = get("api", "OPSWATCH_WEB_URL");
  const apiUrl = mergeApiWorker("OPSWATCH_API_URL");
  const publicApiUrl = get("web", "NEXT_PUBLIC_OPSWATCH_API_URL");

  evaluateSecret({
    variable: "JWT_SECRET",
    services: ["api"],
    api: jwt,
    minLength: 32,
    required: true
  });

  evaluateSecret({
    variable: "WORKER_INTERNAL_SECRET",
    services: ["api", "worker"],
    api: workerSecret.api,
    worker: workerSecret.worker,
    minLength: 16,
    required: true
  });

  if (workerSecret.api && workerSecret.worker && workerSecret.api !== workerSecret.worker) {
    push({
      variable: "WORKER_INTERNAL_SECRET (match)",
      services: ["api", "worker"],
      configured: "partial",
      result: "FAIL",
      notes: "API and worker values do not match"
    });
  } else if (workerSecret.api && workerSecret.worker) {
    push({
      variable: "WORKER_INTERNAL_SECRET (match)",
      services: ["api", "worker"],
      configured: "yes",
      result: "PASS",
      notes: "API and worker secrets match",
      sample: redactValue(workerSecret.api, true)
    });
  }

  evaluateSecret({
    variable: "SEED_ADMIN_PASSWORD",
    services: ["api"],
    api: seedPassword,
    minLength: 16,
    required: false
  });

  const approverEmails =
    approvers
      ?.split(",")
      .map((email) => email.trim())
      .filter(Boolean) ?? [];
  let approverResult: Result = approverEmails.length > 0 ? "PASS" : "WARN";
  let approverNotes =
    approverEmails.length > 0
      ? "Allowlist configured"
      : "Empty allowlist — global playbook approval disabled (safe default)";

  if (approverEmails.some((email) => !isValidEmail(email))) {
    approverResult = "FAIL";
    approverNotes = "One or more approver entries are not valid email addresses";
  }

  push({
    variable: "PLATFORM_PLAYBOOK_APPROVER_EMAILS",
    services: ["api"],
    configured: approverEmails.length > 0 ? "yes" : "no",
    result: approverResult,
    notes: approverNotes,
    sample: approverEmails.length ? `${approverEmails.length} address(es)` : undefined
  });

  evaluateSecret({
    variable: "DATABASE_URL",
    services: ["api", "worker"],
    api: databaseUrl.api,
    worker: databaseUrl.worker,
    required: true
  });

  push({
    variable: "REDIS_URL",
    services: ["api", "worker"],
    configured: "no",
    result: "N/A",
    notes: "Redis is not used by the current OpsWatch runtime; no connection variable required"
  });

  evaluateUrl({
    variable: "OPSWATCH_WEB_URL",
    services: ["api"],
    value: webUrl,
    required: true,
    allowLocalhost: !strictProduction
  });

  evaluateUrl({
    variable: "OPSWATCH_API_URL / NEXT_PUBLIC_OPSWATCH_API_URL",
    services: ["worker", "web"],
    value: apiUrl.worker || publicApiUrl,
    required: true,
    allowLocalhost: !strictProduction
  });

  const smtpHost = get("api", "SMTP_HOST");
  push({
    variable: "SMTP_HOST/SMTP_USER/SMTP_PASS",
    services: ["api", "worker"],
    configured: smtpHost ? "yes" : "no",
    result: smtpHost ? "PASS" : "WARN",
    notes: smtpHost
      ? "SMTP configured for alert delivery"
      : "SMTP not configured — email notifications will not deliver"
  });

  const webhookVars = [
    "WORKER_RESTART_WEBHOOK_URL",
    "SERVICE_RESTART_WEBHOOK_URL",
    "DEPLOYMENT_ROLLBACK_WEBHOOK_URL",
    "VERCEL_WEBHOOK_SECRET",
    "GITHUB_WEBHOOK_SECRET",
    "RENDER_WEBHOOK_SECRET"
  ];
  const configuredWebhooks = webhookVars.filter((key) => Boolean(get("api", key)));
  push({
    variable: "Webhook destinations/secrets",
    services: ["api"],
    configured: configuredWebhooks.length > 0 ? "partial" : "no",
    result: configuredWebhooks.length > 0 ? "PASS" : "WARN",
    notes:
      configuredWebhooks.length > 0
        ? `${configuredWebhooks.length} webhook-related variable(s) configured`
        : "No remediation/ingress webhook secrets configured"
  });

  const forbiddenWebKeys = Object.keys(fileEnv.web).filter(
    (key) =>
      !key.startsWith("NEXT_PUBLIC_") &&
      key !== "NODE_ENV" &&
      /SECRET|PASSWORD|TOKEN|SMTP_PASS|JWT|API_KEY/i.test(key)
  );
  push({
    variable: "Web bundle secret exposure",
    services: ["web"],
    configured: forbiddenWebKeys.length ? "partial" : "yes",
    result: forbiddenWebKeys.length ? "FAIL" : "PASS",
    notes: forbiddenWebKeys.length
      ? `Forbidden web env keys present: ${forbiddenWebKeys.join(", ")}`
      : "Only public web variables detected"
  });

  push({
    variable: "CORS origin policy",
    services: ["api"],
    configured: webUrl ? "yes" : "no",
    result: webUrl ? "PASS" : "FAIL",
    notes: webUrl
      ? `OPSWATCH_WEB_URL included in API CORS allowlist${strictProduction ? "" : " (localhost also allowed outside strict mode)"}`
      : "OPSWATCH_WEB_URL missing — CORS cannot be locked to deployed web origin"
  });

  if (approverEmails.length > 0) {
    const prisma = new PrismaClient();
    try {
      const users = await prisma.user.findMany({
        where: { email: { in: approverEmails }, isActive: true },
        select: { email: true, role: true }
      });
      const missing = approverEmails.filter((email) => !users.some((user) => user.email.toLowerCase() === email.toLowerCase()));
      push({
        variable: "PLATFORM_PLAYBOOK_APPROVER_EMAILS (account lookup)",
        services: ["api"],
        configured: missing.length ? "partial" : "yes",
        result: missing.length ? "FAIL" : "PASS",
        notes: missing.length
          ? `No active user account for: ${missing.join(", ")}`
          : `${users.length} approver account(s) resolved in database`
      });
    } finally {
      await prisma.$disconnect();
    }
  }

  const failures = rows.filter((row) => row.result === "FAIL").length;
  const warnings = rows.filter((row) => row.result === "WARN").length;

  console.log("OPS_WATCH_ENV_VALIDATION");
  console.log(`mode=${strictProduction ? "strict-production" : "target-environment"}`);
  console.log(`summary=pass:${rows.filter((row) => row.result === "PASS").length} warn:${warnings} fail:${failures} na:${rows.filter((row) => row.result === "N/A").length}`);
  console.log("");
  console.log("| Variable | Services | Configured | Result | Notes | Sample |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    console.log(
      `| ${row.variable} | ${row.services.join(", ")} | ${row.configured} | ${row.result} | ${row.notes} | ${row.sample ?? "—"} |`
    );
  }

  if (failures > 0) {
    process.exit(1);
  }
};

main().catch((error) => {
  console.error("ENV_VALIDATION_FAILED", error);
  process.exit(1);
});
