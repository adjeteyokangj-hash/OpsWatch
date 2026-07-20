import { buildConnectionHeaders } from "../agentless-connection.service";
import { joinConnectionUrl } from "../connection-manifest.service";

export type MonitoringHttpErrorCategory =
  | "RATE_LIMITED"
  | "AUTHENTICATION_FAILED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "SERVER_ERROR"
  | "INVALID_RESPONSE"
  | "TIMEOUT";

export class MonitoringHttpError extends Error {
  constructor(
    message: string,
    readonly category: MonitoringHttpErrorCategory,
    readonly statusCode?: number,
    readonly retryable = false
  ) {
    super(message);
    this.name = "MonitoringHttpError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const classifyStatus = (status: number): MonitoringHttpErrorCategory => {
  if (status === 401) return "AUTHENTICATION_FAILED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "INVALID_RESPONSE";
};

export type MonitoringHttpRequest = {
  baseUrl: string;
  path: string;
  authMethod: string;
  secret: string | null;
  configuration: Record<string, unknown>;
  query?: Record<string, string | number | undefined>;
  timeoutMs?: number;
  maxRetries?: number;
  /** Test seam — defaults to real sleep. */
  sleepFn?: (ms: number) => Promise<void>;
};

export const monitoringHttpGetJson = async <T>(
  input: MonitoringHttpRequest
): Promise<{ data: T; statusCode: number; responseTimeMs: number }> => {
  const timeoutMs = input.timeoutMs ?? 15_000;
  const maxRetries = input.maxRetries ?? 3;
  const wait = input.sleepFn ?? sleep;
  const url = new URL(joinConnectionUrl(input.baseUrl, input.path));
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }

  let attempt = 0;
  let lastError: MonitoringHttpError | null = null;
  const startedAt = Date.now();

  while (attempt <= maxRetries) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = buildConnectionHeaders(input.authMethod, input.secret, input.configuration);
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json", ...headers },
        signal: controller.signal,
        redirect: "manual"
      });
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        const backoffMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 2 ** attempt * 1000);
        lastError = new MonitoringHttpError("Rate limited by monitoring source", "RATE_LIMITED", 429, true);
        if (attempt < maxRetries) {
          await wait(backoffMs);
          attempt += 1;
          continue;
        }
        throw lastError;
      }
      if (!response.ok) {
        const category = classifyStatus(response.status);
        const retryable = category === "SERVER_ERROR";
        const error = new MonitoringHttpError(
          `Monitoring source returned HTTP ${response.status}`,
          category,
          response.status,
          retryable
        );
        if (retryable && attempt < maxRetries) {
          await wait(Math.min(30_000, 2 ** attempt * 1000));
          attempt += 1;
          lastError = error;
          continue;
        }
        throw error;
      }
      const data = (await response.json()) as T;
      return {
        data,
        statusCode: response.status,
        responseTimeMs: Date.now() - startedAt
      };
    } catch (error) {
      if (error instanceof MonitoringHttpError) throw error;
      const timedOut = (error as { name?: string }).name === "AbortError";
      const httpError = new MonitoringHttpError(
        timedOut ? "Monitoring source request timed out" : "Monitoring source request failed",
        timedOut ? "TIMEOUT" : "INVALID_RESPONSE",
        undefined,
        timedOut
      );
      if (httpError.retryable && attempt < maxRetries) {
        await wait(Math.min(30_000, 2 ** attempt * 1000));
        attempt += 1;
        lastError = httpError;
        continue;
      }
      throw httpError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new MonitoringHttpError("Monitoring source request failed", "INVALID_RESPONSE");
};
