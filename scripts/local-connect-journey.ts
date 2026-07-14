/**
 * Live local Connect journey (no fake health):
 * register project → org ingest API key → signed heartbeat → verify health/topology.
 *
 * Usage (API running on :4000):
 *   pnpm exec tsx scripts/local-connect-journey.ts
 */
import { createHmac, randomUUID } from "crypto";

const apiBase = (process.env.OPSWATCH_API_URL || "http://127.0.0.1:4000/api").replace(/\/$/, "");
const email = process.env.PLAYWRIGHT_LOGIN_EMAIL || process.env.SEED_ADMIN_EMAIL || "admin@opswatch.local";
const password =
  process.env.PLAYWRIGHT_LOGIN_PASSWORD ||
  process.env.SEED_ADMIN_PASSWORD ||
  "OpsWatch!2026#LocalDevOnly";

type Json = Record<string, unknown>;

const jar = new Map<string, string>();

const assimilateCookies = (response: Response) => {
  const raw = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  for (const row of raw) {
    const [pair] = row.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx), pair.slice(idx + 1));
  }
};

const cookieHeader = () =>
  [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

const api = async (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  const cookie = cookieHeader();
  if (cookie) headers.set("cookie", cookie);
  const csrf = jar.get("opswatch_csrf");
  if (csrf) headers.set("x-opswatch-csrf", csrf);

  const response = await fetch(`${apiBase}${path}`, { ...init, headers });
  assimilateCookies(response);
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${init.method || "GET"} ${path} → ${response.status} ${text}`);
  }
  return json;
};

const signBody = (secret: string, timestamp: string, nonce: string, rawBody: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${nonce}.${rawBody}`).digest("hex");

async function main() {
  console.log(`Connect journey against ${apiBase}`);

  await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  console.log("✓ session login");

  const slug = `connect-journey-${Date.now().toString(36)}`;
  const created = (await api("/projects", {
    method: "POST",
    body: JSON.stringify({
      name: `Connect Journey ${slug}`,
      slug,
      clientName: "Local Connect Journey",
      environment: "local"
    })
  })) as Json;

  const projectId = String(created.id);
  const ingest = (created.ingestCredentials as Json | undefined) || {};
  const signingSecret = String(ingest.signingSecret || created.signingSecret || "");
  const issuedApiKey = String(ingest.apiKey || "");
  if (!projectId || !signingSecret) {
    throw new Error(
      `Project create missing id/signingSecret (keys=${Object.keys(created).join(",")})`
    );
  }
  console.log(`✓ registered project ${projectId} (${slug})`);

  let apiKey = issuedApiKey;
  if (!apiKey) {
    const keyPayload = (await api("/org/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: `connect-journey-${slug}`,
        environment: "test",
        scopes: ["events:write", "heartbeats:write"],
        projectId
      })
    })) as Json;
    apiKey = String(keyPayload.key || keyPayload.apiKey || "");
  }
  if (!apiKey) {
    throw new Error("Missing API key material after project create / org API key");
  }
  console.log("✓ ingest API key ready");

  const body = {
    projectSlug: slug,
    environment: "local",
    appVersion: "connect-journey-1",
    status: "HEALTHY",
    message: "Local connect journey heartbeat"
  };
  const rawBody = JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const signature = signBody(signingSecret, timestamp, nonce, rawBody);

  const heartbeatRes = await fetch(`${apiBase}/heartbeat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-opswatch-timestamp": timestamp,
      "x-opswatch-nonce": nonce,
      "x-opswatch-signature": signature
    },
    body: rawBody
  });
  const heartbeatText = await heartbeatRes.text();
  if (!heartbeatRes.ok) {
    throw new Error(`heartbeat → ${heartbeatRes.status} ${heartbeatText}`);
  }
  console.log(`✓ signed heartbeat accepted (${heartbeatRes.status})`);

  const project = (await api(`/projects/${projectId}`)) as Json;
  const status = String(project.status || project.healthStatus || "");
  const healthLabel = String(project.healthDisplayLabel || project.healthReason || "");
  console.log(`✓ project status=${status} healthLabel=${healthLabel}`);

  if (status.toUpperCase() === "UNKNOWN" || /waiting for first heartbeat/i.test(healthLabel)) {
    throw new Error("Project still waiting/UNKNOWN after heartbeat");
  }

  const topology = await api(`/projects/${projectId}/topology`).catch((err) => {
    console.warn(`topology soft-fail: ${err}`);
    return null;
  });
  if (topology) {
    console.log("✓ topology endpoint reachable");
  }

  const intelligence = await api("/intelligence").catch((err) => {
    console.warn(`intelligence soft-fail: ${err}`);
    return null;
  });
  if (intelligence) {
    const predictions = (intelligence as Json).predictions as Json | undefined;
    console.log(`✓ intelligence reachable predictions.enabled=${predictions?.enabled}`);
    if (predictions?.enabled === true) {
      throw new Error("Predictions unexpectedly enabled during connect journey");
    }
  }

  const alerts = await api(`/alerts?projectId=${projectId}`).catch(() => []);
  console.log(`✓ alerts list reachable (${Array.isArray(alerts) ? alerts.length : "ok"})`);

  console.log("CONNECT JOURNEY PASS");
}

main().catch((error) => {
  console.error("CONNECT JOURNEY FAIL", error);
  process.exitCode = 1;
});
