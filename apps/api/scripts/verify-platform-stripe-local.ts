/**
 * Comprehensive local verification for platform Stripe architecture.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const API = process.env.OPSWATCH_API_URL ?? "http://127.0.0.1:4000/api";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@opswatch.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "OpsWatch!2026#LocalDevOnly";
const VIEWER_EMAIL = "viewer@opswatch.local";
const VIEWER_PASSWORD = "OpsWatch!2026#ViewerOnly";

type Json = Record<string, unknown>;

const parseCookies = (setCookie: string[] | null): string => {
  if (!setCookie?.length) return "";
  return setCookie.map((row) => row.split(";")[0]).join("; ");
};

const login = async (email: string, password: string) => {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  const cookies = parseCookies(response.headers.getSetCookie?.() ?? []);
  const session = await fetch(`${API}/auth/session`, {
    headers: { cookie: cookies }
  });
  const body = (await session.json()) as { user?: Json };
  return { status: response.status, cookies, user: body.user ?? null };
};

const api = async (path: string, cookies: string, init: RequestInit = {}) => {
  const csrf = cookies.match(/opswatch_csrf=([^;]+)/)?.[1];
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(csrf ? { "x-opswatch-csrf": csrf } : {}),
      cookie: cookies,
      ...(init.headers as Record<string, string> | undefined)
    }
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, json };
};

const redact = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  if (value.startsWith("sk_") || value.startsWith("whsec_") || value.startsWith("pk_")) {
    return "[redacted]";
  }
  return value;
};

async function main() {
  const prisma = new PrismaClient();
  const report: Record<string, unknown> = {};

  const unauth = await api("/admin/billing/stripe", "");
  report.unauthenticated = { status: unauth.status, error: (unauth.json as Json)?.error };

  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  report.platformSuperAdminLogin = {
    status: admin.status,
    role: admin.user?.role,
    isPlatformSuperAdmin: admin.user?.isPlatformSuperAdmin
  };

  const adminGetA = await api("/admin/billing/stripe", admin.cookies);
  report.scenarioA_notConfigured = {
    status: adminGetA.status,
    configured: (adminGetA.json as Json)?.configured,
    credentialSource: (adminGetA.json as Json)?.credentialSource,
    secretKeyMasked: (adminGetA.json as Json)?.secretKeyMasked
  };

  const checkoutA = await api("/subscription/checkout", admin.cookies, {
    method: "POST",
    body: JSON.stringify({ planCode: "STARTER", interval: "monthly" })
  });
  report.scenarioA_checkout = { status: checkoutA.status, error: (checkoutA.json as Json)?.error };

  const portalA = await api("/subscription/portal", admin.cookies, { method: "POST", body: "{}" });
  report.scenarioA_portal = { status: portalA.status, error: (portalA.json as Json)?.error };

  const originalStripeKey = process.env.STRIPE_SECRET_KEY;
  const originalWebhook = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_SECRET_KEY = "sk_test_env_fallback_1234567890";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_env_fallback_1234567890";

  const adminGetB = await api("/admin/billing/stripe", admin.cookies);
  report.scenarioB_envFallback = {
    status: adminGetB.status,
    credentialSource: (adminGetB.json as Json)?.credentialSource,
    configured: (adminGetB.json as Json)?.configured,
    secretKeyMasked: (adminGetB.json as Json)?.secretKeyMasked,
    exposesEnvSecret: JSON.stringify(adminGetB.json).includes("sk_test_env_fallback")
  };

  const saveInvalid = await api("/admin/billing/stripe", admin.cookies, {
    method: "PUT",
    body: JSON.stringify({
      publishableKey: "pk_test_invalid_demo",
      secretKey: "sk_test_invalid_demo_key_0000000000",
      webhookSecret: "whsec_invalid_demo_0000000000",
      apiBase: "https://api.stripe.com"
    })
  });
  report.scenarioD_saveInvalid = {
    status: saveInvalid.status,
    secretKeyMasked: (saveInvalid.json as Json)?.secretKeyMasked,
    exposesFullSecret: JSON.stringify(saveInvalid.json).includes("sk_test_invalid_demo_key_0000000000")
  };

  const validateInvalid = await api("/admin/billing/stripe/validate", admin.cookies, { method: "POST" });
  report.scenarioD_validateInvalid = {
    status: validateInvalid.status,
    validationStatus: (validateInvalid.json as Json)?.validationStatus,
    validationMessage: (validateInvalid.json as Json)?.validationMessage,
    exposesAuthorizationHeader: JSON.stringify(validateInvalid.json).toLowerCase().includes("authorization")
  };

  const disconnect = await api("/admin/billing/stripe/disconnect", admin.cookies, { method: "POST" });
  report.scenarioF_disconnect = {
    status: disconnect.status,
    credentialSource: (disconnect.json as Json)?.credentialSource,
    configured: (disconnect.json as Json)?.configured,
    validationMessage: (disconnect.json as Json)?.validationMessage
  };

  const legacy = await api("/admin/billing/stripe/legacy-integrations", admin.cookies);
  const legacyJson = legacy.json as { count?: number; integrations?: Json[] };
  report.legacyProjectStripe = {
    status: legacy.status,
    count: legacyJson.count,
    exposesSecrets: JSON.stringify(legacyJson).match(/sk_|whsec_/) !== null
  };

  const viewer = await login(VIEWER_EMAIL, VIEWER_PASSWORD);
  const viewerStripe = await api("/admin/billing/stripe", viewer.cookies);
  report.viewerAccess = {
    loginStatus: viewer.status,
    role: viewer.user?.role,
    isPlatformSuperAdmin: viewer.user?.isPlatformSuperAdmin,
    adminStripeStatus: viewerStripe.status,
    error: (viewerStripe.json as Json)?.error
  };

  const orgAdminNotAllowlisted = await login("org-admin-not-platform@opswatch.local", ADMIN_PASSWORD).catch(() => null);
  if (!orgAdminNotAllowlisted || orgAdminNotAllowlisted.status !== 200) {
    const org = await prisma.organization.findFirst();
    if (org) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
      await prisma.user.upsert({
        where: { email: "org-admin-not-platform@opswatch.local" },
        update: { role: "ADMIN", organizationId: org.id, passwordHash, isActive: true, updatedAt: new Date() },
        create: {
          id: randomUUID(),
          email: "org-admin-not-platform@opswatch.local",
          name: "Org Admin",
          role: "ADMIN",
          organizationId: org.id,
          passwordHash,
          isActive: true,
          updatedAt: new Date()
        }
      });
    }
  }
  const orgAdmin = await login("org-admin-not-platform@opswatch.local", ADMIN_PASSWORD);
  const orgAdminStripe = await api("/admin/billing/stripe", orgAdmin.cookies);
  report.orgAdminNotInAllowlist = {
    role: orgAdmin.user?.role,
    isPlatformSuperAdmin: orgAdmin.user?.isPlatformSuperAdmin,
    adminStripeStatus: orgAdminStripe.status,
    error: (orgAdminStripe.json as Json)?.error
  };

  const stripeIntegrations = await prisma.projectIntegration.count({ where: { type: "STRIPE" } });
  report.legacyRowsPreservedInDb = stripeIntegrations;

  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripeKey;
  if (originalWebhook === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = originalWebhook;

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
