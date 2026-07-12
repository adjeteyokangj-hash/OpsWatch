const requiredEnvVars = [
  "MONITORING_PROJECT_SLUG",
  "APP_SERVER_HEALTH_URL",
  "DATABASE_HEALTH_URL",
  "ADMIN_ROUTES_HEALTH_URL",
  "CUSTOMER_QUOTE_API_HEALTH_URL",
  "SHOP_API_HEALTH_URL",
  "PAYMENTS_HEALTH_URL",
  "EMAIL_SERVICE_HEALTH_URL",
  "CMS_HEALTH_URL",
  "STORAGE_UPLOADS_HEALTH_URL"
] as const;

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

  for (const key of requiredEnvVars) {
    const raw = process.env[key]?.trim();
    if (!raw) {
      missing.push(key);
      continue;
    }

    if (!isValidHttpUrl(raw)) {
      invalid.push(key);
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    console.error("NINE_ITEM_MONITORING_ENV_INVALID");

    if (missing.length > 0) {
      console.error("Missing required env vars:");
      for (const key of missing) {
        console.error(`- ${key}`);
      }
    }

    if (invalid.length > 0) {
      console.error("Invalid URL env vars (must be http:// or https://):");
      for (const key of invalid) {
        console.error(`- ${key}=${process.env[key]}`);
      }
    }

    process.exit(1);
  }

  console.log("NINE_ITEM_MONITORING_ENV_OK");
};

main();
