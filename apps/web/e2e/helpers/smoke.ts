import { expect, type Page, type TestInfo } from "@playwright/test";
import { isExpectedFailedNetwork, isIgnorableConsole } from "./constants";
import { attachIssueCollector, writeFailureArtifacts, type PageIssueCollector } from "./artifacts";
import {
  assertNoAuthLoop,
  assertNoErrorBoundary,
  blockDevNoise,
  gotoSafe
} from "./auth";

/** Lean waits so multi-route groups stay under the 60s hard cap. */
const READY_MS = 10_000;
const LOADER_MS = 12_000;

const waitLoadingGone = async (page: Page, routeName: string) => {
  const assertGone = async () => {
    await expect(page.locator("body"), `${routeName} workspace loading`).not.toContainText(
      /Loading workspace|Loading project context/i,
      {
        timeout: LOADER_MS
      }
    );
  };
  try {
    await assertGone();
  } catch {
    // Session/proxy blips frequently leave the shell spinner — one soft reload recovers most runs.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    await assertGone();
  }
};

export const smokeGoto = async (page: Page, path: string, urlMatch?: RegExp) => {
  const match = urlMatch || new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const navLabel = path.replace(/^\//, "").split("/")[0] || path;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (page.isClosed()) {
        throw lastError instanceof Error ? lastError : new Error("page closed during smokeGoto");
      }
      await gotoSafe(page, path, 18_000);
      await waitLoadingGone(page, path);
      if (!match.test(page.url())) {
        const link = page.getByRole("link", { name: new RegExp(navLabel, "i") }).first();
        if (await link.count()) {
          await link.click();
          await page.waitForURL(match, { timeout: READY_MS });
          await waitLoadingGone(page, path);
        }
      }
      if (!match.test(page.url())) {
        throw new Error(`expected url ${match} got ${page.url()}`);
      }
      return;
    } catch (error) {
      lastError = error;
      if (page.isClosed()) break;
      await page.waitForTimeout(300 * (attempt + 1)).catch(() => undefined);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

export const smokeAssertReady = async (
  page: Page,
  routeName: string,
  heading: RegExp | string,
  marker?: RegExp
) => {
  await assertNoAuthLoop(page);
  await assertNoErrorBoundary(page, routeName);
  await waitLoadingGone(page, routeName);

  const listLoader = page.getByText(/Loading (applications|organization|intelligence|sign-in|integrations)/i);
  try {
    await expect(listLoader).toHaveCount(0, { timeout: 6_000 });
  } catch {
    // Marker / heading assertions below catch stuck content.
  }

  const text = await page.locator("body").innerText();
  expect(text.length, `${routeName} blank`).toBeGreaterThan(40);

  const headingLocator = page.getByTestId("page-heading");
  if (await headingLocator.count()) {
    await expect(headingLocator.first()).toBeVisible({ timeout: READY_MS });
    await expect(headingLocator.first()).toHaveText(heading, { timeout: READY_MS });
  } else {
    await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: READY_MS });
  }

  if (marker) {
    const body = await page.locator("body").innerText();
    expect(body, `${routeName} missing marker`).toMatch(marker);
  }
};

export const assertSmokeHealth = (issues: PageIssueCollector, label: string) => {
  const criticalConsole = issues.consoleErrors
    .concat(issues.pageErrors)
    .filter((row) => !isIgnorableConsole(row));
  const unexpectedNetwork = issues.failedResponses.filter(
    (row) => !isExpectedFailedNetwork(row.status, row.url)
  );
  expect(criticalConsole, `${label} console/page errors: ${criticalConsole.join(" | ")}`).toEqual([]);
  expect(
    unexpectedNetwork,
    `${label} failed network: ${unexpectedNetwork.map((r) => `${r.status} ${r.url}`).join(" | ")}`
  ).toEqual([]);
};

type SmokeBody = (issues: PageIssueCollector) => Promise<void>;

/** Shared bootstrap + failure artifact capture for independent smoke groups. */
export const runSmokeGroup = async (
  page: Page,
  testInfo: TestInfo,
  label: string,
  body: SmokeBody
) => {
  await blockDevNoise(page);
  const issues = attachIssueCollector(page);
  const started = Date.now();
  try {
    await body(issues);
    assertSmokeHealth(issues, label);
    // eslint-disable-next-line no-console
    console.log(`SMOKE_GROUP_OK ${label} ${Date.now() - started}ms`);
  } catch (error) {
    const dir = await writeFailureArtifacts(page, testInfo, issues, label).catch(() => "(no-artifacts)");
    // eslint-disable-next-line no-console
    console.error(`SMOKE_GROUP_FAIL ${label} ${Date.now() - started}ms ARTIFACTS ${dir}`);
    // eslint-disable-next-line no-console
    console.error(`FAIL_URL ${page.url()}`);
    throw error;
  }
};
