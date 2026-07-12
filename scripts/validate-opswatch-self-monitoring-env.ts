import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(__dirname, "../apps/api/.env") });

const required = [
  "OPSWATCH_WEB_HEALTH_URL",
  "OPSWATCH_API_READY_URL",
  "OPSWATCH_WEB_LOGIN_URL",
  "OPSWATCH_API_LIVE_URL"
] as const;

const optional = ["EXTERNAL_UPTIME_CHECK_URL", "OPSWATCH_NOTIFICATION_PROBE_URL", "OPSWATCH_WEBHOOK_PROBE_URL"] as const;

const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const main = (): void => {
  const missing: string[] = [];
  const invalid: string[] = [];

  for (const key of required) {
    const value = process.env[key]?.trim();
    if (!value) missing.push(key);
    else if (!isValidHttpUrl(value)) invalid.push(key);
  }

  if (missing.length > 0 || invalid.length > 0) {
    console.error("OPSWATCH_SELF_MONITORING_ENV_INVALID");
    if (missing.length) console.error(`Missing: ${missing.join(", ")}`);
    if (invalid.length) console.error(`Invalid URL: ${invalid.join(", ")}`);
    process.exit(1);
  }

  console.log("OPSWATCH_SELF_MONITORING_ENV_OK");
  console.log(`self_monitor_slug=${process.env.OPSWATCH_SELF_MONITOR_SLUG?.trim() || "opswatch-production"}`);
  console.log(
    JSON.stringify(
      {
        required: required.map((key) => ({ key, configured: true })),
        optional: optional.map((key) => ({ key, configured: Boolean(process.env[key]?.trim()) }))
      },
      null,
      2
    )
  );
};

main();
