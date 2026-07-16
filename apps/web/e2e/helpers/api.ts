/**
 * Prefer proxied same-origin API for cookie-auth Playwright calls.
 * Direct :4000 needs explicit Cookie headers (Secure cookies on http).
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { apiBase, proxiedApiBase } from "./constants";
import { apiAuthHeaders } from "./auth";

export const authedGet = async (page: Page, path: string, timeout = 30_000) => {
  const headers = await apiAuthHeaders(page);
  return page.request.get(`${proxiedApiBase}${path}`, { headers, timeout });
};

export const authedPost = async (
  page: Page,
  path: string,
  data: unknown,
  timeout = 60_000
) => {
  const headers = await apiAuthHeaders(page, { "content-type": "application/json" });
  return page.request.post(`${proxiedApiBase}${path}`, { headers, data, timeout });
};

/** Ingest heartbeat always hits API origin (API key auth, not session cookies). */
export const ingestPost = async (
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
  data: unknown
) => request.post(`${apiBase}${path}`, { headers, data, timeout: 30_000 });
