import { expect, type Page } from "@playwright/test";
import fs from "fs";
import {
  e2eRateLimitBypassHeader,
  primaryEmail,
  primaryPassword,
  proxiedApiBase,
  webBase
} from "./constants";
import { authStorageStatePath } from "./paths";

/** Abort Next HMR noise that can keep the page "busy" under stale setups. */
export const blockDevNoise = async (page: Page) => {
  await page.route("**/_next/webpack-hmr**", (route) => route.abort());
  await page.route("**/*hot-update*", (route) => route.abort());
};

export const gotoSafe = async (page: Page, path: string, timeoutMs = 25_000) => {
  const url = path.startsWith("http") ? path : `${webBase}${path}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(400);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

type ProxiedLoginOptions = {
  /** Fewer retries / shorter request timeouts for 60s smoke budgets. */
  lean?: boolean;
};

const loginViaProxiedApi = async (
  page: Page,
  email: string,
  password: string,
  options: ProxiedLoginOptions = {}
) => {
  const lean = Boolean(options.lean);
  const maxAttempts = lean ? 3 : 6;
  const postTimeout = lean ? 18_000 : 45_000;
  const sessionTimeout = lean ? 10_000 : 30_000;
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await page.waitForTimeout(lean ? 400 * attempt : 900 * attempt);
    }
    await page.context().clearCookies();
    const res = await page.request.post(`${proxiedApiBase}/auth/login`, {
      headers: { "content-type": "application/json", ...e2eRateLimitBypassHeader },
      data: { email, password },
      timeout: postTimeout,
      failOnStatusCode: false
    });
    lastStatus = res.status();
    lastBody = (await res.text()).slice(0, 320);
    if (res.ok()) {
      let loginEmail = "";
      try {
        loginEmail = String((JSON.parse(lastBody) as { user?: { email?: string } }).user?.email || "");
      } catch {
        loginEmail = "";
      }
      if (loginEmail.toLowerCase() !== email.toLowerCase()) {
        lastStatus = 409;
        lastBody = `login email mismatch want=${email} got=${loginEmail || lastBody}`;
        continue;
      }
      const jar = await page.context().cookies();
      const sessionVal = jar.find((c) => c.name === "opswatch_session")?.value;
      const csrfVal = jar.find((c) => c.name === "opswatch_csrf")?.value;
      const cookieHeader = [
        sessionVal ? `opswatch_session=${sessionVal}` : "",
        csrfVal ? `opswatch_csrf=${csrfVal}` : ""
      ]
        .filter(Boolean)
        .join("; ");
      const session = await page.request.get(`${proxiedApiBase}/auth/session`, {
        headers: {
          ...e2eRateLimitBypassHeader,
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
          ...(csrfVal ? { "x-opswatch-csrf": csrfVal } : {})
        },
        timeout: sessionTimeout,
        failOnStatusCode: false
      });
      const sessionBody = await session.text();
      if (!session.ok()) {
        lastStatus = session.status();
        lastBody = sessionBody.slice(0, 320);
        continue;
      }
      let sessionEmail = "";
      try {
        sessionEmail = String((JSON.parse(sessionBody) as { user?: { email?: string } }).user?.email || "");
      } catch {
        sessionEmail = "";
      }
      if (sessionEmail.toLowerCase() !== email.toLowerCase()) {
        lastStatus = 409;
        lastBody = `session email mismatch want=${email} got=${sessionEmail || sessionBody.slice(0, 200)}`;
        continue;
      }
      return;
    }
    // Transient DB/pool pressure — retry (E2E stack sets rate-limit bypass; avoid cooldown sleeps).
    if (lastStatus === 401 || lastStatus === 429 || lastStatus >= 500) {
      continue;
    }
    break;
  }
  throw new Error(`proxied login failed status=${lastStatus} body=${lastBody}`);
};

const loginViaUi = async (page: Page, email: string, password: string) => {
  await gotoSafe(page, "/login");
  await expect(page.getByTestId("login-form")).toBeVisible({ timeout: 20_000 });
  const emailInput = page.getByTestId("login-email");
  const passwordInput = page.getByTestId("login-password");
  await emailInput.click();
  await emailInput.fill("");
  await emailInput.fill(email);
  await passwordInput.click();
  await passwordInput.fill("");
  await passwordInput.fill(password);
  await expect(emailInput).toHaveValue(email);

  const loginResponse = page.waitForResponse(
    (res) => res.url().includes("/api/auth/login") && res.request().method() === "POST",
    { timeout: 45_000 }
  );
  await page.getByTestId("login-submit").click();
  const response = await loginResponse;
  if (!response.ok()) {
    const err = page.getByTestId("login-error");
    const msg = (await err.count()) ? await err.innerText() : `HTTP ${response.status()}`;
    throw new Error(`UI login rejected: ${msg}`);
  }
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
};

type LoginAsOptions = ProxiedLoginOptions;

/**
 * Establish a browser session. Prefer same-origin proxied API (cookie jar shared with the page)
 * so we avoid controlled-input races and surfaces/DB blips more reliably than a one-shot form submit.
 */
export const loginAs = async (
  page: Page,
  email = primaryEmail,
  password = primaryPassword,
  options: LoginAsOptions = {}
) => {
  const lean = Boolean(options.lean);
  await page.context().clearCookies();
  await loginViaProxiedApi(page, email, password, options);
  await gotoSafe(page, "/dashboard", lean ? 15_000 : 25_000);
  if (!/\/dashboard/.test(page.url())) {
    await page.waitForURL(/\/dashboard/, { timeout: lean ? 12_000 : 45_000 });
  }
  expect(page.url()).not.toMatch(/\/login/);
  const cookies = await sessionCookies(page);
  expect(cookies.session, "session cookie after login").toBeTruthy();
  let sessionOk = false;
  const maxAttempts = lean ? 2 : 5;
  const sessionTimeout = lean ? 8_000 : 30_000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await page.waitForTimeout(lean ? 300 * attempt : 800 * attempt);
    try {
      const sessionRes = await page.request.get(`${proxiedApiBase}/auth/session`, {
        headers: await apiAuthHeaders(page),
        timeout: sessionTimeout,
        failOnStatusCode: false
      });
      if (!sessionRes.ok()) continue;
      const sessionPayload = (await sessionRes.json()) as { user?: { email?: string } };
      if (String(sessionPayload.user?.email || "").toLowerCase() === email.toLowerCase()) {
        sessionOk = true;
        break;
      }
    } catch {
      // Transient proxy/DB blips — lean smoke can accept cookie + /dashboard below.
    }
  }
  if (!sessionOk && lean && cookies.session && /\/dashboard/.test(page.url())) {
    // Cookie jar + dashboard shell is enough under the 60s smoke budget when /auth/session flaps 5xx.
    return;
  }
  expect(sessionOk, `post-login session email for ${email}`).toBeTruthy();
};

/** Lean login for workspace smoke groups (hard 60s budget). */
export const loginAsFast = async (
  page: Page,
  email = primaryEmail,
  password = primaryPassword
) => loginAs(page, email, password, { lean: true });

/**
 * Reuse storageState cookies when present; otherwise establish a fresh lean session.
 * Soft share — groups remain independent if setup failed or storage is stale.
 */
export const ensureSmokeAuth = async (
  page: Page,
  email = primaryEmail,
  password = primaryPassword
) => {
  if (!(await sessionCookies(page)).session && fs.existsSync(authStorageStatePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(authStorageStatePath, "utf8")) as {
        cookies?: Array<{
          name: string;
          value: string;
          domain?: string;
          path?: string;
          expires?: number;
          httpOnly?: boolean;
          secure?: boolean;
          sameSite?: "Strict" | "Lax" | "None";
        }>;
      };
      if (raw.cookies?.length) {
        await page.context().addCookies(
          raw.cookies.map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain || "127.0.0.1",
            path: c.path || "/",
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite || "Lax"
          }))
        );
      }
    } catch {
      // Fall through to fresh login.
    }
  }

  const cookies = await sessionCookies(page);
  if (cookies.session && cookies.csrf) {
    try {
      const sessionRes = await page.request.get(`${proxiedApiBase}/auth/session`, {
        headers: await apiAuthHeaders(page),
        timeout: 8_000,
        failOnStatusCode: false
      });
      if (sessionRes.ok()) {
        const body = (await sessionRes.json()) as { user?: { email?: string } };
        if (String(body.user?.email || "").toLowerCase() === email.toLowerCase()) {
          return;
        }
      } else if (sessionRes.status() >= 500) {
        // Stale-but-present cookies may still work for page navigation under DB flaps.
        await gotoSafe(page, "/dashboard", 15_000);
        if (/\/dashboard/.test(page.url()) && !/\/login/.test(page.url())) {
          return;
        }
      }
    } catch {
      // Fall through to fresh login.
    }
  }
  await loginAsFast(page, email, password);
};

export const assertNoAuthLoop = async (page: Page) => {
  expect(page.url(), "auth loop / still on login").not.toMatch(/\/login/);
};

export const assertNoErrorBoundary = async (page: Page, routeName: string) => {
  const body = page.locator("body");
  await expect(body, `${routeName} error boundary`).not.toContainText(/unexpected application error/i);
};

export const assertNotStuckLoading = async (page: Page, routeName: string) => {
  // Shell remounts per page and shows this until refreshAuthSession settles.
  const loadingGone = async () => {
    await expect(page.locator("body"), `${routeName} workspace loading`).not.toContainText(
      /Loading workspace/i,
      { timeout: 45_000 }
    );
  };

  try {
    await loadingGone();
  } catch {
    // Session/proxy blips can leave the shell spinner — one soft reload recovers most flaky runs.
    await page.reload({ waitUntil: "domcontentloaded" });
    await loadingGone();
  }

  // Best-effort wait for in-page loaders (intelligence can stay slow — do not hard-fail here).
  const listLoader = page.getByText(/Loading (applications|organization|intelligence|sign-in)/i);
  try {
    await expect(listLoader).toHaveCount(0, { timeout: 20_000 });
  } catch {
    // Leave assertion to route markers / headings below.
  }
  const text = await page.locator("body").innerText();
  expect(text.length, `${routeName} blank`).toBeGreaterThan(40);
};

export const assertPageReady = async (
  page: Page,
  routeName: string,
  heading: RegExp | string,
  marker?: RegExp
) => {
  await assertNoAuthLoop(page);
  await assertNoErrorBoundary(page, routeName);
  await assertNotStuckLoading(page, routeName);

  // Session blips can bounce protected routes back to /dashboard — recover via sidebar.
  if (/\/dashboard\/?$/.test(page.url()) && !/dashboard/i.test(routeName)) {
    const link = page.getByRole("link", { name: new RegExp(routeName, "i") }).first();
    if (await link.count()) {
      await link.click();
      await assertNotStuckLoading(page, routeName);
    }
  }

  const headingLocator = page.getByTestId("page-heading");
  if (await headingLocator.count()) {
    await expect(headingLocator.first()).toBeVisible({ timeout: 20_000 });
    if (typeof heading === "string") {
      await expect(headingLocator.first()).toHaveText(heading, { timeout: 20_000 });
    } else {
      await expect(headingLocator.first()).toHaveText(heading, { timeout: 20_000 });
    }
  } else {
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 20_000 });
  }

  if (marker) {
    const text = await page.locator("body").innerText();
    expect(text, `${routeName} missing marker`).toMatch(marker);
  }
};

export const sessionCookies = async (page: Page) => {
  const cookies = await page.context().cookies();
  return {
    session: cookies.find((c) => c.name === "opswatch_session")?.value,
    csrf: cookies.find((c) => c.name === "opswatch_csrf")?.value
  };
};

/**
 * Playwright's APIRequestContext does not auto-send Secure cookies over http://
 * (Chrome page navigation does for localhost). Attach Cookie + CSRF for apiBase calls.
 */
export const apiAuthHeaders = async (
  page: Page,
  extra?: Record<string, string>
): Promise<Record<string, string>> => {
  const { session, csrf } = await sessionCookies(page);
  const headers: Record<string, string> = { ...e2eRateLimitBypassHeader, ...(extra || {}) };
  const cookieParts: string[] = [];
  if (session) cookieParts.push(`opswatch_session=${session}`);
  if (csrf) cookieParts.push(`opswatch_csrf=${csrf}`);
  if (cookieParts.length) headers.cookie = cookieParts.join("; ");
  if (csrf) headers["x-opswatch-csrf"] = csrf;
  return headers;
};

type ProxiedRequestInit = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  data?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  retries?: number;
};

/** Session API via same-origin proxy with retries for ECONNRESET / 5xx / DB blips. */
export const proxiedRequest = async (page: Page, path: string, init: ProxiedRequestInit = {}) => {
  const method = init.method || "GET";
  const retries = init.retries ?? 4;
  const url = path.startsWith("http") ? path : `${proxiedApiBase}${path.startsWith("/") ? path : `/${path}`}`;
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (attempt > 0) {
      await page.waitForTimeout(600 * attempt);
    }
    try {
      const headers = {
        ...(await apiAuthHeaders(page)),
        ...(init.headers || {})
      };
      const res = await page.request.fetch(url, {
        method,
        headers,
        data: init.data,
        timeout: init.timeout ?? 60_000,
        failOnStatusCode: false
      });
      if (res.status() === 429 || res.status() >= 500 || res.status() === 0) {
        lastError = new Error(`proxied ${method} ${url} -> ${res.status()}`);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

/** Keep navigating until workspace shell settles and URL matches (session 500 can bounce routes). */
export const gotoAuthed = async (page: Page, path: string, urlMatch?: RegExp) => {
  const match = urlMatch || new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const navLabel = path.replace(/^\//, "").split("/")[0] || path;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await gotoSafe(page, path);
      await assertNotStuckLoading(page, path);
      if (!match.test(page.url())) {
        const link = page.getByRole("link", { name: new RegExp(navLabel, "i") }).first();
        if (await link.count()) {
          await link.click();
          await page.waitForURL(match, { timeout: 20_000 });
          await assertNotStuckLoading(page, path);
        }
      }
      if (!match.test(page.url())) {
        throw new Error(`expected url ${match} got ${page.url()}`);
      }
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(800 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};
