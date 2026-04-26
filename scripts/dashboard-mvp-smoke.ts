const webBase = process.env.OPSWATCH_WEB_URL || "http://localhost:3002";

const pages = [
  "/dashboard",
  "/projects",
  "/alerts",
  "/incidents",
  "/status",
  "/accuracy",
  "/auto-run-policy"
];

const checkPage = async (path: string): Promise<void> => {
  const response = await fetch(`${webBase}${path}`);
  if (!response.ok) {
    throw new Error(`Page ${path} failed with ${response.status}`);
  }

  const html = await response.text();
  if (!html.includes("OpsWatch")) {
    throw new Error(`Page ${path} did not return expected shell content`);
  }

  console.log(`PAGE_OK ${path}`);
};

const main = async (): Promise<void> => {
  for (const page of pages) {
    await checkPage(page);
  }

  console.log("DASHBOARD_MVP_PATHS_OK");
};

void main().catch((error) => {
  console.error("DASHBOARD_MVP_PATHS_FAILED", error);
  process.exit(1);
});
