import { Router } from "express";
import { requireCmsApiKey } from "../middleware/cms-api-key";
import {
  CMS_DEV_API_KEY,
  getModuleContent,
  listCmsCapabilities,
  listDraftModules,
  listPublishedModules,
  publishModuleContent,
  putModuleContent,
  rollbackModuleContent
} from "../services/cms-content/cms-content.service";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * OkangGroup CMS Content API.
 * Mounted at /api/cms so gateway base_url = https://…/api/cms
 * Paths: /health, /v1/capabilities, /v1/modules/:code/content|publish|rollback
 */
export const cmsContentRouter = Router();

const correlation = (req: { header: (name: string) => string | undefined }) =>
  req.header("x-correlation-id")?.trim() || crypto.randomUUID();

cmsContentRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "opswatch-cms-content",
    adapter: "opswatch_marketing",
    environment: process.env.NODE_ENV ?? "development",
    live_client: false,
    scope: "marketing_website_content_only"
  });
});

/** Public published snapshot for OpsWatch marketing site reads (no secrets). */
cmsContentRouter.get("/v1/published", async (_req, res) => {
  const modules = await listPublishedModules();
  res.json({ ok: true, modules });
});

cmsContentRouter.get("/v1/capabilities", requireCmsApiKey, (_req, res) => {
  res.json({ ...listCmsCapabilities(), correlation_id: correlation(_req) });
});

cmsContentRouter.get("/v1/modules/:moduleCode/content", requireCmsApiKey, async (req, res) => {
  const moduleCode = String(req.params.moduleCode ?? "");
  const state = await getModuleContent(moduleCode);
  if (!state) {
    res.status(404).json({ ok: false, error: "Module not found", correlation_id: correlation(req) });
    return;
  }
  res.json({ ok: true, correlation_id: correlation(req), ...state });
});

cmsContentRouter.put("/v1/modules/:moduleCode/content", requireCmsApiKey, async (req, res) => {
  const moduleCode = String(req.params.moduleCode ?? "");
  const result = await putModuleContent(moduleCode, req.body ?? {});
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error, correlation_id: correlation(req) });
    return;
  }
  res.json({ ok: true, correlation_id: correlation(req), ...result.state });
});

cmsContentRouter.post("/v1/modules/:moduleCode/publish", requireCmsApiKey, async (req, res) => {
  const moduleCode = String(req.params.moduleCode ?? "");
  const result = await publishModuleContent(moduleCode);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error, correlation_id: correlation(req) });
    return;
  }
  res.json({ ok: true, correlation_id: correlation(req), ...result.state });
});

cmsContentRouter.post("/v1/modules/:moduleCode/rollback", requireCmsApiKey, async (req, res) => {
  const moduleCode = String(req.params.moduleCode ?? "");
  const revisionNo =
    typeof req.body?.revision_no === "number" ? req.body.revision_no : undefined;
  const result = await rollbackModuleContent(moduleCode, revisionNo);
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error, correlation_id: correlation(req) });
    return;
  }
  res.json({ ok: true, correlation_id: correlation(req), ...result.state });
});

/** Known local preview fallback. Never used when NODE_ENV is production. */
export const CMS_DEV_PREVIEW_SECRET = "opswatch-cms-preview-dev-secret";

/**
 * Dedicated preview secret, otherwise the configured CMS API key.
 * Production refuses the known development literals.
 */
export const resolveCmsPreviewSecret = (): string | null => {
  const dedicated = process.env.OPSWATCH_CMS_PREVIEW_SECRET?.trim() || "";
  const apiKey = process.env.OPSWATCH_CMS_API_KEY?.trim() || "";
  if (process.env.NODE_ENV === "production") {
    if (dedicated && dedicated !== CMS_DEV_PREVIEW_SECRET) return dedicated;
    if (apiKey && apiKey !== CMS_DEV_API_KEY) return apiKey;
    return null;
  }
  return dedicated || apiKey || CMS_DEV_PREVIEW_SECRET;
};

export const signCmsPreviewToken = (ttlSeconds = 3600): string | null => {
  const secret = resolveCmsPreviewSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ exp, scope: "cms_preview" })).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
};

export const verifyCmsPreviewToken = (token: string | null | undefined): boolean => {
  const secret = resolveCmsPreviewSecret();
  if (!secret || !token?.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  } catch {
    return false;
  }
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: number };
    return typeof body.exp === "number" && body.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
};

cmsContentRouter.post("/v1/preview-token", requireCmsApiKey, (_req, res) => {
  const token = signCmsPreviewToken();
  if (!token) {
    res.status(503).json({
      ok: false,
      error: "Preview signing is not configured",
      correlation_id: correlation(_req)
    });
    return;
  }
  res.json({
    ok: true,
    token,
    expires_in_seconds: 3600,
    correlation_id: correlation(_req)
  });
});

cmsContentRouter.get("/v1/preview", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  if (!verifyCmsPreviewToken(token)) {
    res.status(401).json({ ok: false, error: "Invalid or expired preview token" });
    return;
  }
  const modules = await listDraftModules();
  res.json({ ok: true, preview: true, modules });
});
