import fs from "fs";
import path from "path";
import type { Page, TestInfo } from "@playwright/test";
import { artifactsRoot } from "./constants";

export type PageIssueCollector = {
  consoleErrors: string[];
  pageErrors: string[];
  failedResponses: Array<{ status: number; url: string; method: string }>;
  statuses: Array<{ status: number; url: string; method: string }>;
};

export const attachIssueCollector = (page: Page): PageIssueCollector => {
  const collector: PageIssueCollector = {
    consoleErrors: [],
    pageErrors: [],
    failedResponses: [],
    statuses: []
  };

  page.on("console", (msg) => {
    if (msg.type() === "error") collector.consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => {
    collector.pageErrors.push(String(err.message || err));
  });
  page.on("response", (response) => {
    const status = response.status();
    const url = response.url();
    const method = response.request().method();
    if (!/127\.0\.0\.1:(3000|4000)|localhost:(3000|4000)/.test(url)) return;
    collector.statuses.push({ status, url, method });
    if (status >= 400) {
      collector.failedResponses.push({ status, url, method });
    }
  });

  return collector;
};

export const writeFailureArtifacts = async (
  page: Page,
  testInfo: TestInfo,
  issues: PageIssueCollector,
  label: string
): Promise<string> => {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = label.replace(/[^\w.-]+/g, "_").slice(0, 80);
  const dir = path.join(artifactsRoot, `${stamp}_${safe}`);
  fs.mkdirSync(dir, { recursive: true });

  const visibleText = await page.locator("body").innerText().catch(() => "");
  const url = page.url();

  await page.screenshot({ path: path.join(dir, "screenshot.png"), fullPage: true }).catch(() => undefined);

  fs.writeFileSync(
    path.join(dir, "diagnostics.json"),
    JSON.stringify(
      {
        label,
        testTitle: testInfo.title,
        url,
        visibleText: visibleText.slice(0, 20_000),
        consoleErrors: issues.consoleErrors,
        pageErrors: issues.pageErrors,
        failedResponses: issues.failedResponses,
        statusList: issues.statuses.slice(-80)
      },
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(path.join(dir, "console.txt"), issues.consoleErrors.concat(issues.pageErrors).join("\n"), "utf8");
  fs.writeFileSync(
    path.join(dir, "failed-requests.txt"),
    issues.failedResponses.map((r) => `${r.status} ${r.method} ${r.url}`).join("\n"),
    "utf8"
  );
  fs.writeFileSync(path.join(dir, "url.txt"), url, "utf8");
  fs.writeFileSync(path.join(dir, "visible-text.txt"), visibleText.slice(0, 20_000), "utf8");

  await testInfo.attach("failure-diagnostics", {
    path: path.join(dir, "diagnostics.json"),
    contentType: "application/json"
  });

  return dir;
};
