/**
 * Issue a MarketingCmsApiKey for the OkangGroup CMS gateway.
 *
 * Refuses unless OPSWATCH_CMS_KEY_ISSUE_APPROVED=yes. That flag is the
 * explicit Owner approval gate. Do not set it during local verification.
 *
 * Prints metadata only. Plaintext goes to a temp file outside both repos.
 * Does not load Prisma until approval is present.
 */
const approved = process.env.OPSWATCH_CMS_KEY_ISSUE_APPROVED === "yes";
if (!approved) {
  console.error("refused=owner_approval_required");
  console.error("Issuance stays inactive until explicit Owner approval sets OPSWATCH_CMS_KEY_ISSUE_APPROVED=yes.");
  process.exit(1);
}

async function main() {
  const { randomBytes } = await import("crypto");
  const { mkdirSync, writeFileSync } = await import("fs");
  const { join } = await import("path");
  const { prisma } = await import("../src/lib/prisma");
  const { createCmsApiKey, resolveDevCmsApiKey } = await import(
    "../src/services/cms-content/cms-content.service"
  );

  try {
    const rows = await prisma.marketingCmsApiKey.findMany({
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        isActive: true,
        revokedAt: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
    const active = rows.filter((row) => row.isActive && !row.revokedAt);
    console.log(`existing_keys_total=${rows.length}`);
    console.log(`existing_keys_active=${active.length}`);
    for (const row of active) {
      console.log(
        ["active_key", row.id, row.name, row.keyPrefix, row.createdAt.toISOString()].join("|")
      );
    }

    const envFallback = resolveDevCmsApiKey();
    console.log(`env_or_dev_fallback_present=${Boolean(envFallback)}`);
    console.log(
      `env_or_dev_fallback_is_hardcoded_dev=${envFallback === "opswatch-cms-dev-key-not-for-production"}`
    );
    if (process.env.NODE_ENV === "production" && !process.env.OPSWATCH_CMS_API_KEY?.trim()) {
      console.log("production_env_key_configured=no");
      console.log("issued_key_is_database_credential=yes");
    }

    const issued = await createCmsApiKey("OkangGroup Managed Websites gateway");
    const secretDir = "C:/Users/edwar/Documents/OKANGGROUP-backups/secrets";
    mkdirSync(secretDir, { recursive: true });
    const secretPath = join(secretDir, `opswatch-cms-api-key-${randomBytes(8).toString("hex")}.tmp`);
    writeFileSync(secretPath, issued.apiKey, { encoding: "utf8" });
    writeFileSync(
      "C:/Users/edwar/Documents/OKANGGROUP-backups/opswatch-cms-key.pointer.json",
      JSON.stringify(
        {
          secret_path: secretPath,
          key_id: issued.id,
          key_prefix: issued.prefix,
          name: "OkangGroup Managed Websites gateway",
          created_at_utc: new Date().toISOString(),
          note: "Plaintext key file is outside both repos; consume into OkangGroup vault then delete."
        },
        null,
        2
      )
    );

    console.log(`issued_key_id=${issued.id}`);
    console.log(`issued_key_prefix=${issued.prefix}`);
    console.log("secret_file_written=yes");
    console.log("plaintext_logged=no");
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
