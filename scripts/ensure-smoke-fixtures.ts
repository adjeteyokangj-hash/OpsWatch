/**
 * Ensure second-org fixtures for browser org-isolation smoke.
 * Does NOT consolidate orgs (unlike prisma seed's local fixup).
 *
 *   pnpm exec tsx scripts/ensure-smoke-fixtures.ts
 */
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseEnvFile } from "./lib/env-utils";

const rootDir = path.resolve(__dirname, "..");
const apiEnv = parseEnvFile(path.join(rootDir, "apps/api/.env"));
for (const key of ["DATABASE_URL"] as const) {
  if (!process.env[key] && apiEnv[key]) {
    process.env[key] = apiEnv[key];
  }
}

const prisma = new PrismaClient();

const ORG_SLUG = process.env.PLAYWRIGHT_ISOLATION_ORG_SLUG || "smoke-isolation-b";
const ORG_NAME = "Smoke Isolation B";
const USER_EMAIL = process.env.PLAYWRIGHT_ISOLATION_EMAIL || "smoke-isolation-b@opswatch.local";
const USER_PASSWORD = process.env.PLAYWRIGHT_ISOLATION_PASSWORD || "OpsWatch!SmokeIsolationB16";
const PROJECT_SLUG = process.env.PLAYWRIGHT_ISOLATION_PROJECT_SLUG || "smoke-isolation-app-b";

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: ORG_NAME, updatedAt: new Date() },
    create: {
      id: randomUUID(),
      name: ORG_NAME,
      slug: ORG_SLUG,
      updatedAt: new Date()
    }
  });

  const passwordHash = await bcrypt.hash(USER_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: USER_EMAIL },
    update: {
      passwordHash,
      isActive: true,
      organizationId: org.id,
      role: "ADMIN",
      updatedAt: new Date()
    },
    create: {
      id: randomUUID(),
      email: USER_EMAIL,
      name: "Smoke Isolation B Admin",
      passwordHash,
      organizationId: org.id,
      role: "ADMIN",
      isActive: true,
      updatedAt: new Date()
    }
  });

  const project = await prisma.project.upsert({
    where: { slug: PROJECT_SLUG },
    update: {
      organizationId: org.id,
      name: "Smoke Isolation App B",
      clientName: "Isolation Fixture",
      environment: "test",
      updatedAt: new Date()
    },
    create: {
      id: randomUUID(),
      name: "Smoke Isolation App B",
      slug: PROJECT_SLUG,
      clientName: "Isolation Fixture",
      environment: "test",
      apiKey: randomUUID(),
      signingSecret: randomUUID(),
      organizationId: org.id,
      updatedAt: new Date()
    }
  });

  // Ensure primary admin stays on a different org if present
  const primary = await prisma.user.findUnique({ where: { email: "admin@opswatch.local" } });
  if (primary && primary.organizationId === org.id) {
    const other = await prisma.organization.findFirst({
      where: { slug: { in: ["okanggroup", "opswatch-default"] }, NOT: { id: org.id } }
    });
    if (other) {
      await prisma.user.update({
        where: { id: primary.id },
        data: { organizationId: other.id, updatedAt: new Date() }
      });
      console.log(`Moved admin@opswatch.local to org ${other.slug}`);
    }
  }

  console.log(
    JSON.stringify({
      orgId: org.id,
      orgSlug: org.slug,
      userId: user.id,
      email: USER_EMAIL,
      projectId: project.id,
      projectSlug: project.slug
    })
  );
}

main()
  .catch((error) => {
    console.error("ensure-smoke-fixtures FAIL", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
