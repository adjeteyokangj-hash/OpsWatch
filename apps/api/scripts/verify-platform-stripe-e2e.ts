/**
 * End-to-end platform Stripe admin verification against running API.
 */
const API = process.env.OPSWATCH_API_URL ?? "http://127.0.0.1:4000/api";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@opswatch.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "OpsWatch!2026#LocalDevOnly";
const VIEWER_EMAIL = "viewer@opswatch.local";
const VIEWER_PASSWORD = "OpsWatch!2026#ViewerOnly";

type Json = Record<string, unknown>;

const parseCookies = (setCookie: string[] | null): string =>
  setCookie?.length ? setCookie.map((row) => row.split(";")[0]).join("; ") : "";

const login = async (email: string, password: string) => {
  const response = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!response.ok) throw new Error(`Login failed for ${email}: ${response.status}`);
  const cookies = parseCookies(response.headers.getSetCookie?.() ?? []);
  const session = await fetch(`${API}/auth/session`, { headers: { cookie: cookies } });
  const body = (await session.json()) as { user?: Json };
  return { cookies, user: body.user ?? {} };
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
  const json = (await response.json().catch(() => ({}))) as Json;
  return { status: response.status, json };
};

async function main() {
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  const viewer = await login(VIEWER_EMAIL, VIEWER_PASSWORD);

  const disconnect = await api("/admin/billing/stripe/disconnect", admin.cookies, { method: "POST" });
  const afterDisconnect = await api("/admin/billing/stripe", admin.cookies);

  const save = await api("/admin/billing/stripe", admin.cookies, {
    method: "PUT",
    body: JSON.stringify({
      publishableKey: "pk_test_e2e_platform",
      secretKey: "sk_test_e2e_platform_key_1234567890",
      webhookSecret: "whsec_e2e_platform_1234567890",
      apiBase: "https://api.stripe.com"
    })
  });

  const afterSave = await api("/admin/billing/stripe", admin.cookies);
  const validate = await api("/admin/billing/stripe/validate", admin.cookies, { method: "POST" });
  const afterValidate = await api("/admin/billing/stripe", admin.cookies);
  const disconnectAgain = await api("/admin/billing/stripe/disconnect", admin.cookies, { method: "POST" });
  const afterSecondDisconnect = await api("/admin/billing/stripe", admin.cookies);

  const viewerDenied = await api("/admin/billing/stripe", viewer.cookies);

  const report = {
    superAdminSession: { isPlatformSuperAdmin: admin.user.isPlatformSuperAdmin },
    disconnect: {
      status: disconnect.status,
      credentialSource: disconnect.json.credentialSource,
      configured: disconnect.json.configured
    },
    save: {
      status: save.status,
      credentialSource: (save.json as Json).credentialSource,
      masked: (save.json as Json).secretKeyMasked,
      exposesSecret: JSON.stringify(save.json).includes("sk_test_e2e_platform_key")
    },
    afterSave: {
      credentialSource: afterSave.json.credentialSource,
      publishableKey: afterSave.json.publishableKey
    },
    validate: {
      status: validate.status,
      validationStatus: validate.json.validationStatus,
      exposesAuthHeader: JSON.stringify(validate.json).toLowerCase().includes("authorization")
    },
    afterValidate: {
      lastValidatedAt: afterValidate.json.lastValidatedAt,
      validationMessage: afterValidate.json.validationMessage,
      mode: afterValidate.json.mode
    },
    disconnectAgain: {
      status: disconnectAgain.status,
      credentialSource: disconnectAgain.json.credentialSource,
      configured: disconnectAgain.json.configured,
      message: disconnectAgain.json.validationMessage
    },
    envFallbackAfterDisconnect: {
      credentialSource: afterSecondDisconnect.json.credentialSource,
      configured: afterSecondDisconnect.json.configured
    },
    viewerDenied: { status: viewerDenied.status, error: viewerDenied.json.error }
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
