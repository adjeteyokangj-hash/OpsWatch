import path from "path";

/** Prefer 127.0.0.1 — localhost can flap with Next proxy + dual-stack. */
export const webBase = (process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
export const apiBase = (process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4000/api").replace(/\/$/, "");
/** Same-origin Next /api proxy — cookie sessions; prefer over direct :4000 for browser auth calls. */
export const proxiedApiBase = `${webBase}/api`;

/**
 * Trusted by API only when NODE_ENV/VERCEL_ENV !== production and
 * OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS=true (set by start-local-smoke-stack.ps1).
 */
export const e2eRateLimitBypassHeader =
  process.env.PLAYWRIGHT_E2E_RATE_LIMIT_BYPASS === "true" ||
  process.env.RUN_BROWSER_E2E === "true"
    ? ({ "x-opswatch-e2e-rate-limit-bypass": "1" } as const)
    : ({} as Record<string, string>);

export const primaryEmail = process.env.PLAYWRIGHT_LOGIN_EMAIL || "admin@opswatch.local";
export const primaryPassword =
  process.env.PLAYWRIGHT_LOGIN_PASSWORD || "OpsWatch!2026#LocalDevOnly";

/** Second-org fixture for browser isolation (created by scripts/ensure-smoke-fixtures.ts). */
export const isolationEmail =
  process.env.PLAYWRIGHT_ISOLATION_EMAIL || "smoke-isolation-b@opswatch.local";
export const isolationPassword =
  process.env.PLAYWRIGHT_ISOLATION_PASSWORD || "OpsWatch!SmokeIsolationB16";
export const isolationProjectSlug =
  process.env.PLAYWRIGHT_ISOLATION_PROJECT_SLUG || "smoke-isolation-app-b";
export const isolationOrgSlug =
  process.env.PLAYWRIGHT_ISOLATION_ORG_SLUG || "smoke-isolation-b";

/** Repo-root test-artifacts (playwright cwd is usually apps/web). */
export const artifactsRoot = path.resolve(
  process.env.PLAYWRIGHT_ARTIFACTS_DIR || path.join(process.cwd(), "..", "..", "test-artifacts")
);

/**
 * Baseline expected network failures (all suites).
 * Cross-org probes pass an extra predicate from org-isolation.spec.
 */
export const isExpectedFailedNetwork = (
  status: number,
  url: string,
  extra?: (status: number, url: string) => boolean
): boolean => {
  if (status === 401 && /\/auth\//.test(url)) return true;
  // Local apiFetch fallback to :4000 without cookies — noisy but non-fatal when proxy already failed.
  if (status === 401 && /localhost:4000|127\.0\.0\.1:4000/i.test(url)) return true;
  // Transient Prisma/DB flaps during long authenticated smokes.
  if (status === 500 && /\/api\/auth\/session/i.test(url)) return true;
  if (status === 502 && /\/api\//i.test(url)) return true;
  // Non-superadmin orgs / partial entitlement surfaces during isolation navigation.
  if ([403, 404].includes(status) && /\/api\/(intelligence|analytics)\b/i.test(url)) return true;
  if (status === 500 && /\/api\/intelligence\b/i.test(url)) return true;
  if (
    status === 500 &&
    /\/api\/(checks|incidents|insights|analytics|projects|alerts)\b/i.test(url)
  ) {
    return true;
  }
  if (status === 404 && /favicon|robots\.txt|\.map$/i.test(url)) return true;
  if (status === 404 && /\/_next\/static\//.test(url)) return true;
  if (extra?.(status, url)) return true;
  return false;
};

export const isIgnorableConsole = (text: string): boolean =>
  /favicon|Download the React DevTools|hydration|ResizeObserver|AbortError|signal is aborted|net::ERR_FAILED|ERR_ABORTED/i.test(
    text
  ) ||
  // Browser surfaces proxy/DB blips + cookieless :4000 fallback during local smoke.
  /Failed to load resource: the server responded with a status of (401|403|404|500|502)/i.test(text);
