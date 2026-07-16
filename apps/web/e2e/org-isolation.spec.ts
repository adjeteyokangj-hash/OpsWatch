import { expect, test } from "@playwright/test";
import {
  isolationEmail,
  isolationOrgSlug,
  isolationPassword,
  isolationProjectSlug,
  isExpectedFailedNetwork,
  isIgnorableConsole,
  primaryEmail,
  primaryPassword
} from "./helpers/constants";
import { attachIssueCollector, writeFailureArtifacts } from "./helpers/artifacts";
import {
  assertPageReady,
  blockDevNoise,
  gotoAuthed,
  gotoSafe,
  loginAs,
  proxiedRequest,
  sessionCookies
} from "./helpers/auth";

test.describe("org isolation browser", () => {
  test.skip(
    process.env.RUN_BROWSER_E2E !== "true",
    "Set RUN_BROWSER_E2E=true with API + web already running."
  );

  test("own apps only; foreign detail blocked; scoped surfaces", async ({ page }, testInfo) => {
    test.setTimeout(210_000);
    await blockDevNoise(page);
    const issues = attachIssueCollector(page);
    const capture: Array<{ step: string; status?: number; ui?: string }> = [];

    try {
      // Resolve foreign project id via isolation user session (API)
      await loginAs(page, isolationEmail, isolationPassword);
      const isoCookies = await sessionCookies(page);
      expect(isoCookies.session).toBeTruthy();

      const isoProjectsRes = await proxiedRequest(page, "/projects");
      expect(isoProjectsRes.status(), `iso projects ${await isoProjectsRes.text()}`).toBe(200);
      const isoProjects = (await isoProjectsRes.json()) as Array<{ id: string; slug: string; name: string }>;
      // eslint-disable-next-line no-console
      console.log("ISO_PROJECTS", isoProjects.map((p) => p.slug).join(","));
      const foreign = isoProjects.find((p) => p.slug === isolationProjectSlug);
      expect(foreign, `isolation project ${isolationProjectSlug} missing — run ensure-smoke-fixtures`).toBeTruthy();
      const foreignId = foreign!.id;
      expect(
        isoProjects.some((p) => /^pw-connect-/i.test(p.slug)),
        `isolation session leaked org-A projects: ${isoProjects.map((p) => p.slug).join(",")}`
      ).toBeFalsy();
      capture.push({ step: "iso-project", status: 200, ui: foreignId });

      await gotoAuthed(page, "/projects", /\/projects/);
      await assertPageReady(page, "Applications B", /Applications/i);
      const slugRe = /Smoke Isolation App B|smoke-isolation-app-b|Isolation Fixture/i;
      await expect(page.locator("body")).toContainText(slugRe, { timeout: 45_000 });
      const bodyB = await page.locator("body").innerText();
      expect(bodyB).toMatch(slugRe);
      // Should not dump OkangGroup-only production apps typically absent from B
      capture.push({ step: "org-b-list", ui: bodyB.slice(0, 500) });

      // Logout → primary org A
      await page.getByRole("button", { name: /logout/i }).click();
      await page.waitForURL(/\/login/, { timeout: 20_000 });
      await loginAs(page, primaryEmail, primaryPassword);
      await sessionCookies(page);

      await gotoAuthed(page, "/projects", /\/projects/);
      await assertPageReady(page, "Applications A", /Applications/i);
      const bodyA = await page.locator("body").innerText();
      expect(bodyA, "org A must not list isolation-B app").not.toMatch(slugRe);
      capture.push({ step: "org-a-list-no-leak", ui: "ok" });

      // Direct URL to foreign project — UI should reject (avoid gotoAuthed reload, which can bounce to dashboard).
      await gotoSafe(page, `/projects/${foreignId}`);
      await expect(page.locator("body")).not.toContainText(/Loading workspace|Loading project context/i, {
        timeout: 45_000
      });
      const foreignBody = await page.locator("body").innerText();
      const blockedUi =
        /Project not found/i.test(foreignBody) ||
        (!new RegExp(foreignId, "i").test(page.url()) && !slugRe.test(foreignBody));
      expect(blockedUi, `foreign UI leak url=${page.url()} text=${foreignBody.slice(0, 240)}`).toBeTruthy();
      capture.push({ step: "direct-url-ui", ui: blockedUi ? "blocked" : "leak" });

      // API status for foreign project
      const foreignApi = await proxiedRequest(page, `/projects/${foreignId}`);
      expect([403, 404]).toContain(foreignApi.status());
      capture.push({ step: "direct-url-api", status: foreignApi.status() });

      // Topology / incidents / alerts / intelligence scoped (no foreign name leak)
      for (const path of ["/incidents", "/alerts", "/intelligence"] as const) {
        await gotoSafe(page, path);
        await expect(page.locator("body")).not.toContainText(/Loading workspace/i, { timeout: 45_000 });
        const text = await page.locator("body").innerText();
        expect(text).not.toMatch(slugRe);
        expect(text).not.toMatch(/smoke-isolation-app-b/i);
        capture.push({ step: `scoped-${path}`, ui: "no foreign slug" });
      }

      const topoApi = await proxiedRequest(page, `/projects/${foreignId}/topology`);
      expect([403, 404, 429]).toContain(topoApi.status());
      capture.push({ step: "topology-api", status: topoApi.status() });

      // Refresh isolation: reload projects — still no foreign slug
      await gotoAuthed(page, "/projects", /\/projects/);
      await page.reload({ waitUntil: "domcontentloaded" });
      await assertPageReady(page, "Applications refresh", /Applications/i);
      const afterRefresh = await page.locator("body").innerText();
      expect(afterRefresh).not.toMatch(slugRe);
      capture.push({ step: "refresh-no-leak", ui: "ok" });

      // eslint-disable-next-line no-console
      console.log("ORG_ISOLATION_CAPTURE", JSON.stringify(capture));

      const criticalConsole = issues.consoleErrors
        .concat(issues.pageErrors)
        .filter((row) => !isIgnorableConsole(row));
      const unexpectedNetwork = issues.failedResponses.filter(
        (row) =>
          !isExpectedFailedNetwork(row.status, row.url, (status, url) => {
            if (![403, 404].includes(status)) return false;
            return (
              url.includes(foreignId) ||
              /\/(projects|topology)\//i.test(url) ||
              /Project not found/i.test(url)
            );
          })
      );
      expect(criticalConsole, criticalConsole.join(" | ")).toEqual([]);
      expect(
        unexpectedNetwork,
        unexpectedNetwork.map((r) => `${r.status} ${r.url}`).join(" | ")
      ).toEqual([]);

      expect(isolationOrgSlug).toBeTruthy();
    } catch (error) {
      const dir = await writeFailureArtifacts(page, testInfo, issues, "org-isolation");
      // eslint-disable-next-line no-console
      console.error("ARTIFACTS", dir, capture);
      throw error;
    }
  });
});
