import { randomUUID } from "crypto";
import * as tls from "tls";
import { URL } from "url";
import { parseSafeExternalHttpUrl } from "@opswatch/shared";
import { recordInternalSecurityEvents } from "./security-internal-bridge.service";
import type { SecurityEventIngestInput } from "./security-ingest.service";

export type ExternalSurfaceCheckInput = {
  organizationId: string;
  projectId?: string | null;
  environment?: string;
  entityId?: string | null;
  targetUrl: string;
  /** Passive observation only unless explicitly authorised. */
  mode?: "PASSIVE" | "SAFE_VALIDATION";
  previousFingerprint?: string | null;
  previousHeaders?: Record<string, string | null> | null;
};

export type ExternalSurfaceCheckResult = {
  ok: boolean;
  error?: string;
  events: SecurityEventIngestInput[];
  fingerprint?: string;
  tlsValidTo?: string;
  headers?: Record<string, string | null>;
  ingested?: { accepted: number; rejected: number };
};

const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options"
] as const;

const ADMIN_PATH_HINTS = ["/admin", "/wp-admin", "/administrator", "/manage"];
const DIAGNOSTIC_PATH_HINTS = ["/debug", "/.env", "/actuator", "/metrics", "/healthz", "/phpinfo"];

const headerMap = (headers: Headers): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  for (const name of SECURITY_HEADERS) {
    out[name] = headers.get(name);
  }
  return out;
};

const contentFingerprint = (body: string, contentType: string | null): string => {
  const sample = `${contentType || ""}|${body.slice(0, 2048)}`;
  let hash = 0;
  for (let i = 0; i < sample.length; i += 1) hash = (hash * 31 + sample.charCodeAt(i)) >>> 0;
  return hash.toString(16);
};

const readTlsExpiry = async (hostname: string, port: number): Promise<Date | null> =>
  new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port, servername: hostname, rejectUnauthorized: false, timeout: 5000 },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (cert && cert.valid_to) {
          const date = new Date(cert.valid_to);
          resolve(Number.isNaN(date.getTime()) ? null : date);
          return;
        }
        resolve(null);
      }
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });

/**
 * Safe, non-destructive external attack-surface checks.
 * Active security testing remains out of scope.
 */
export const runExternalSurfaceCheck = async (
  input: ExternalSurfaceCheckInput
): Promise<ExternalSurfaceCheckResult> => {
  const mode = input.mode || "SAFE_VALIDATION";
  try {
    parseSafeExternalHttpUrl(input.targetUrl);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unsafe outbound URL",
      events: []
    };
  }

  const parsed = new URL(input.targetUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { ok: false, error: "only http/https allowed", events: [] };
  }

  const events: SecurityEventIngestInput[] = [];
  const now = new Date();
  const base = {
    environment: input.environment || "production",
    projectId: input.projectId || null,
    entityId: input.entityId || null,
    providerSource: "external_surface_check",
    timestamp: now
  };

  // TLS validity (https only)
  if (parsed.protocol === "https:") {
    const port = parsed.port ? Number(parsed.port) : 443;
    const validTo = await readTlsExpiry(parsed.hostname, port);
    if (validTo) {
      const days = (validTo.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
      if (days < 14) {
        events.push({
          ...base,
          eventType: "TLS_EXPIRING",
          severity: days < 7 ? "HIGH" : "MEDIUM",
          idempotencyKey: `tls-expiring:${parsed.hostname}:${validTo.toISOString().slice(0, 10)}`,
          payload: { hostname: parsed.hostname, validTo: validTo.toISOString(), daysRemaining: Math.floor(days) }
        });
      }
    }
  }

  if (mode === "PASSIVE") {
    return { ok: true, events, headers: input.previousHeaders || undefined };
  }

  // SAFE_VALIDATION: single GET with redirect limit; SSRF already checked.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response: Response;
  try {
    response = await fetch(input.targetUrl, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "OpsWatch-SecuritySurface/1.0" }
    });
  } catch (error) {
    clearTimeout(timer);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "fetch failed",
      events
    };
  }
  clearTimeout(timer);

  // Block unsafe redirects to private hosts
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get("location");
    if (location) {
      try {
        const next = new URL(location, input.targetUrl);
        parseSafeExternalHttpUrl(next.toString());
        if (input.previousHeaders?.["x-opswatch-redirect"] && input.previousHeaders["x-opswatch-redirect"] !== next.toString()) {
          events.push({
            ...base,
            eventType: "REDIRECT_CHANGE",
            severity: "MEDIUM",
            idempotencyKey: `redirect:${parsed.hostname}:${next.pathname}`,
            payload: { from: input.previousHeaders["x-opswatch-redirect"], to: next.toString() }
          });
        }
      } catch {
        events.push({
          ...base,
          eventType: "REDIRECT_CHANGE",
          severity: "HIGH",
          idempotencyKey: `redirect-unsafe:${parsed.hostname}:${randomUUID().slice(0, 8)}`,
          payload: { location, note: "Redirect target failed outbound safety checks" }
        });
      }
    }
  }

  const headers = headerMap(response.headers);
  for (const name of SECURITY_HEADERS) {
    const previous = input.previousHeaders?.[name];
    const current = headers[name];
    if (previous && !current) {
      events.push({
        ...base,
        eventType: "SECURITY_HEADER_REMOVED",
        severity: "MEDIUM",
        idempotencyKey: `header-removed:${parsed.hostname}:${name}:${now.toISOString().slice(0, 13)}`,
        payload: { header: name, url: input.targetUrl }
      });
    }
  }

  const body = await response.text().catch(() => "");
  const fingerprint = contentFingerprint(body, response.headers.get("content-type"));
  if (input.previousFingerprint && input.previousFingerprint !== fingerprint) {
    events.push({
      ...base,
      eventType: "CONTENT_FINGERPRINT_CHANGE",
      severity: "LOW",
      idempotencyKey: `fingerprint:${parsed.hostname}:${fingerprint}`,
      payload: { previous: input.previousFingerprint, current: fingerprint }
    });
  }

  const pathLower = parsed.pathname.toLowerCase();
  if (ADMIN_PATH_HINTS.some((hint) => pathLower.includes(hint)) && response.status < 400) {
    events.push({
      ...base,
      eventType: "ADMIN_URL_EXPOSED",
      severity: "HIGH",
      idempotencyKey: `admin-exposed:${parsed.hostname}:${parsed.pathname}`,
      payload: { url: input.targetUrl, status: response.status }
    });
  }
  if (DIAGNOSTIC_PATH_HINTS.some((hint) => pathLower.includes(hint)) && response.status < 400) {
    events.push({
      ...base,
      eventType: "DIAGNOSTIC_ENDPOINT_EXPOSED",
      severity: "HIGH",
      idempotencyKey: `diag-exposed:${parsed.hostname}:${parsed.pathname}`,
      payload: { url: input.targetUrl, status: response.status }
    });
  }

  if (response.status >= 500) {
    events.push({
      ...base,
      eventType: "PUBLIC_ENDPOINT_STATUS_CHANGE",
      severity: "MEDIUM",
      idempotencyKey: `status:${parsed.hostname}:${response.status}:${now.toISOString().slice(0, 13)}`,
      payload: { url: input.targetUrl, status: response.status }
    });
  }

  const ingested = events.length
    ? await recordInternalSecurityEvents(input.organizationId, events, "external_surface_check")
    : { accepted: 0, rejected: 0, duplicates: 0, results: [] };

  return {
    ok: true,
    events,
    fingerprint,
    headers: { ...headers, "x-opswatch-redirect": response.headers.get("location") },
    ingested: { accepted: ingested.accepted, rejected: ingested.rejected }
  };
};
