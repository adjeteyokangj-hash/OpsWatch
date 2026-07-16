import { expect, test as setup } from "@playwright/test";
import fs from "fs";
import path from "path";
import { blockDevNoise, loginAsFast, sessionCookies } from "./helpers/auth";
import { primaryEmail, primaryPassword } from "./helpers/constants";
import { authStorageStatePath } from "./helpers/paths";

setup.skip(
  process.env.RUN_BROWSER_E2E !== "true",
  "Set RUN_BROWSER_E2E=true with API + web already running (PLAYWRIGHT_SKIP_WEB_SERVER=true)."
);

setup("authenticate and persist storageState", async ({ page }) => {
  setup.setTimeout(60_000);
  await blockDevNoise(page);
  await loginAsFast(page, primaryEmail, primaryPassword);

  const cookies = await sessionCookies(page);
  expect(cookies.session, "session cookie for storageState").toBeTruthy();
  expect(cookies.csrf, "csrf cookie for storageState").toBeTruthy();

  fs.mkdirSync(path.dirname(authStorageStatePath), { recursive: true });
  await page.context().storageState({ path: authStorageStatePath });
  // eslint-disable-next-line no-console
  console.log("AUTH_STORAGE_STATE", authStorageStatePath);
});
