/**
 * Local Phase 1 verification: put → publish → published read → rollback.
 * Requires OpsWatch API on OPSWATCH_API_URL (default http://localhost:4000/api).
 * Does not push or deploy.
 */
const apiBase = (process.env.OPSWATCH_API_URL || "http://localhost:4000/api").replace(/\/$/, "");
const cmsBase = `${apiBase}/cms`;
const apiKey =
  process.env.OPSWATCH_CMS_API_KEY || "opswatch-cms-dev-key-not-for-production";

const sampleHome = {
  slug: "home",
  cmsKey: "opswatch.page.home",
  metaTitle: "OpsWatch CMS verify",
  metaDescription: "Local Phase 1 verification title",
  hero: {
    eyebrow: "CMS verify",
    title: "Phase 1 published homepage title",
    subtitle: "Published via OkangGroup CMS content API"
  },
  sections: [
    {
      id: "capabilities",
      cmsKey: "opswatch.page.home.capabilities",
      title: "Verified capabilities operators can trust",
      body: "CMS verification body"
    }
  ]
};

async function req(path, { method = "GET", body, key } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["X-Api-Key"] = key;
  const res = await fetch(`${cmsBase}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};

async function main() {
  console.log(`CMS verify against ${cmsBase}`);

  const health = await req("/health");
  if (!health.ok || health.json?.adapter !== "opswatch_marketing") {
    fail(`health expected opswatch_marketing, got ${health.status} ${JSON.stringify(health.json)}`);
    return;
  }
  console.log("OK health");

  const denied = await req("/v1/capabilities");
  if (denied.status !== 401) {
    fail(`capabilities without key should 401, got ${denied.status}`);
    return;
  }
  console.log("OK capabilities deny without key");

  const caps = await req("/v1/capabilities", { key: apiKey });
  if (!caps.ok || caps.json?.capabilities?.customer_data !== false) {
    fail(`capabilities failed: ${JSON.stringify(caps.json)}`);
    return;
  }
  console.log("OK capabilities");

  const put1 = await req("/v1/modules/opswatch.page.home/content", {
    method: "PUT",
    key: apiKey,
    body: sampleHome
  });
  if (!put1.ok) {
    fail(`put failed: ${JSON.stringify(put1.json)}`);
    return;
  }
  const pub1 = await req("/v1/modules/opswatch.page.home/publish", {
    method: "POST",
    key: apiKey,
    body: {}
  });
  if (!pub1.ok) {
    fail(`publish1 failed: ${JSON.stringify(pub1.json)}`);
    return;
  }
  console.log("OK put+publish v1");

  const published = await req("/v1/published");
  if (!published.ok || published.json?.modules?.["opswatch.page.home"]?.hero?.title !== sampleHome.hero.title) {
    fail(`published snapshot missing title: ${JSON.stringify(published.json)}`);
    return;
  }
  console.log("OK published read");

  const second = {
    ...sampleHome,
    hero: { ...sampleHome.hero, title: "Phase 1 second published title" }
  };
  await req("/v1/modules/opswatch.page.home/content", { method: "PUT", key: apiKey, body: second });
  await req("/v1/modules/opswatch.page.home/publish", { method: "POST", key: apiKey, body: {} });

  const rolled = await req("/v1/modules/opswatch.page.home/rollback", {
    method: "POST",
    key: apiKey,
    body: { revision_no: 1 }
  });
  if (!rolled.ok || rolled.json?.published?.hero?.title !== sampleHome.hero.title) {
    fail(`rollback failed: ${JSON.stringify(rolled.json)}`);
    return;
  }
  console.log("OK rollback");

  const billingReject = await req("/v1/modules/opswatch.page.pricing/content", {
    method: "PUT",
    key: apiKey,
    body: {
      slug: "pricing",
      cmsKey: "opswatch.page.pricing",
      metaTitle: "Pricing",
      metaDescription: "x",
      hero: { eyebrow: "P", title: "T", subtitle: "S" },
      sections: [],
      monthlyPrice: 99
    }
  });
  if (billingReject.ok) {
    fail("billing field should be rejected");
    return;
  }
  console.log("OK billing field rejected");

  console.log("Phase 1 local CMS verification PASSED");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
