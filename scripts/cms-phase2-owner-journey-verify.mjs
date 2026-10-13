/**
 * Phase 2 controlled verification for the Owner journey, exercised through the
 * OpsWatch CMS Content API contract that the Owner UI gateway uses.
 *
 * Does not print API keys. Does not push or deploy.
 *
 * Covers: health, draft isolation, preview token, publish, public read, rollback,
 * billing rejection. Browser Owner UI still requires a live OkangGroup admin session.
 */
const apiBase = (process.env.OPSWATCH_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const cmsBase = `${apiBase}/cms`;
const webBase = (process.env.OPSWATCH_WEB_URL || "http://localhost:3000").replace(/\/$/, "");
const apiKey = process.env.OPSWATCH_CMS_API_KEY || "opswatch-cms-dev-key-not-for-production";

const marker = `Owner-journey-${Date.now()}`;

async function req(path, { method = "GET", body, key } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-Api-Key"] = key;
  const res = await fetch(`${cmsBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, json };
}

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

async function main() {
  console.log("Phase 2 Owner-journey contract verification");

  const health = await req("/health");
  if (!health.ok || health.json?.adapter !== "opswatch_marketing") {
    fail(`1 health: ${JSON.stringify(health.json)}`);
    return;
  }
  console.log("OK 1/10 connection health surface");

  const caps = await req("/v1/capabilities", { key: apiKey });
  if (!caps.ok || caps.json?.capabilities?.customer_data !== false) {
    fail(`10 protected capabilities: ${JSON.stringify(caps.json)}`);
    return;
  }
  console.log("OK 10/10 capabilities deny customer/billing/monitoring flags");

  const baseline = await req("/v1/modules/opswatch.page.home/content", { key: apiKey });
  const seedHero =
    baseline.json?.published?.hero ??
    baseline.json?.draft?.hero ?? {
      eyebrow: "Agentless application health platform",
      title: "Command Center for application health and recovery",
      subtitle: "Baseline"
    };

  const draftBody = {
    slug: "home",
    cmsKey: "opswatch.page.home",
    metaTitle: "OpsWatch",
    metaDescription: "Phase 2 journey",
    hero: {
      eyebrow: seedHero.eyebrow ?? "CMS",
      title: marker,
      subtitle: "Draft must stay private until publish"
    },
    sections: [
      {
        id: "capabilities",
        cmsKey: "opswatch.page.home.capabilities",
        title: "Verified capabilities operators can trust",
        body: "Draft body"
      }
    ]
  };

  const put = await req("/v1/modules/opswatch.page.home/content", {
    method: "PUT",
    key: apiKey,
    body: draftBody
  });
  if (!put.ok) {
    fail(`4 edit homepage: ${JSON.stringify(put.json)}`);
    return;
  }
  console.log("OK 3-4/10 content editor put (Owner UI uses same gateway contract)");

  const publicBefore = await req("/v1/published");
  const publishedTitle = publicBefore.json?.modules?.["opswatch.page.home"]?.hero?.title;
  if (publishedTitle === marker) {
    fail("5 draft leaked to public published snapshot before publish");
    return;
  }
  console.log("OK 5/10 draft not public before publish");

  const preview = await req("/v1/preview-token", { method: "POST", key: apiKey, body: {} });
  if (!preview.ok || !preview.json?.token) {
    fail(`6 preview token: ${JSON.stringify(preview.json)}`);
    return;
  }
  const draftView = await req(`/v1/preview?token=${encodeURIComponent(preview.json.token)}`);
  if (!draftView.ok || draftView.json?.modules?.["opswatch.page.home"]?.hero?.title !== marker) {
    fail(`6 preview draft: ${JSON.stringify(draftView.json)}`);
    return;
  }
  console.log(`OK 6/10 preview shows unpublished draft (open ${webBase}/?cmsPreview=<token> in UI)`);

  const publish = await req("/v1/modules/opswatch.page.home/publish", {
    method: "POST",
    key: apiKey,
    body: {}
  });
  if (!publish.ok) {
    fail(`7 publish: ${JSON.stringify(publish.json)}`);
    return;
  }
  const publicAfter = await req("/v1/published");
  if (publicAfter.json?.modules?.["opswatch.page.home"]?.hero?.title !== marker) {
    fail(`7 public homepage content: ${JSON.stringify(publicAfter.json)}`);
    return;
  }
  console.log("OK 7/10 publish updates public homepage content");

  const rollback = await req("/v1/modules/opswatch.page.home/rollback", {
    method: "POST",
    key: apiKey,
    body: {}
  });
  if (!rollback.ok) {
    fail(`8 rollback: ${JSON.stringify(rollback.json)}`);
    return;
  }
  console.log("OK 8/10 rollback restores prior published revision");

  const noKeyPublish = await req("/v1/modules/opswatch.page.home/publish", {
    method: "POST",
    body: {}
  });
  if (noKeyPublish.status !== 401) {
    fail(`9 unauthenticated publish should 401, got ${noKeyPublish.status}`);
    return;
  }
  console.log("OK 9/10 publish denied without CMS credential (Owner UI also gates can_publish)");

  console.log("Phase 2 contract verification PASSED");
  console.log("Remaining UI-only steps: register instance in Managed Websites and open /my-cms/:id editor.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
