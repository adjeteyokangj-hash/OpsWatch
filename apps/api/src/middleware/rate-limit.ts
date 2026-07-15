const requestMap = new Map<string, { count: number; resetAt: number }>();

const windowMs = 60_000;
const DEFAULT_MAX_PER_WINDOW = 200;
/** Local interactive / unit-smoke headroom (never applied in production-like envs). */
const DEV_MAX_PER_WINDOW = 5_000;

/** Trusted Playwright header — honored only when non-prod + OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS=true. */
export const E2E_RATE_LIMIT_BYPASS_HEADER = "x-opswatch-e2e-rate-limit-bypass";

type HeaderBag = { headers?: Record<string, unknown> };

export const isProductionLikeEnvironment = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (env.NODE_ENV === "production") return true;
  if (env.VERCEL_ENV === "production") return true;
  return false;
};

const headerValue = (req: HeaderBag, name: string): string => {
  const raw = req.headers?.[name] ?? req.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return String(raw[0] ?? "");
  if (raw == null) return "";
  return String(raw);
};

/**
 * Local/E2E-only rate-limit bypass for auth-heavy Playwright smokes.
 * Always false when NODE_ENV or VERCEL_ENV is production.
 */
export const shouldRelaxAuthRateLimit = (
  req: HeaderBag,
  env: NodeJS.ProcessEnv = process.env
): boolean => {
  if (isProductionLikeEnvironment(env)) {
    return false;
  }

  if (env.OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT === "true") {
    return true;
  }

  if (env.OPSWATCH_ALLOW_E2E_RATE_LIMIT_BYPASS === "true") {
    const value = headerValue(req, E2E_RATE_LIMIT_BYPASS_HEADER).trim().toLowerCase();
    if (value === "1" || value === "true") {
      return true;
    }
  }

  return false;
};

export const maxRequestsPerWindow = (env: NodeJS.ProcessEnv = process.env): number => {
  if (isProductionLikeEnvironment(env)) {
    return DEFAULT_MAX_PER_WINDOW;
  }
  if (
    env.NODE_ENV === "development" ||
    env.OPSWATCH_RELAX_RATE_LIMIT === "true" ||
    env.OPSWATCH_E2E_RELAX_AUTH_RATE_LIMIT === "true"
  ) {
    return DEV_MAX_PER_WINDOW;
  }
  return DEFAULT_MAX_PER_WINDOW;
};

/** Test helper — clears the in-memory IP buckets. */
export const resetRateLimitBucketsForTests = (): void => {
  requestMap.clear();
};

export const rateLimit = (req: any, res: any, next: () => void) => {
  if (shouldRelaxAuthRateLimit(req)) {
    next();
    return;
  }

  const maxPerWindow = maxRequestsPerWindow();
  const key = req.ip || "unknown";
  const now = Date.now();
  const bucket = requestMap.get(key);

  if (!bucket || now > bucket.resetAt) {
    requestMap.set(key, { count: 1, resetAt: now + windowMs });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > maxPerWindow) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  next();
};
