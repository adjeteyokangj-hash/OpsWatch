import { randomBytes, randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";
import { generateApiKey, generateSigningSecret, sha256 } from "../apps/api/src/utils/crypto";
import { seedNobleExpressGraph } from "./lib/noble-express-graph.seed";

const prisma = new PrismaClient();

const projectSlug = process.env.NOBLE_EXPRESS_PROJECT_SLUG?.trim() || "noble-express";
const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@okanggroup.com";

const requireEnv = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`${key} is required`);
  }
  return value;
};

async function resolveCanonicalOrg() {
  const orgs = await prisma.organization.findMany({
    include: { _count: { select: { Project: true } } },
    orderBy: { Project: { _count: "desc" } }
  });
  if (orgs.length === 0) {
    throw new Error("No organizations found");
  }
  return orgs[0]!;
}

async function ensureNobleProject(orgId: string) {
  const frontendUrl = process.env.NOBLE_FRONTEND_URL?.trim() || null;
  const backendUrl = process.env.NOBLE_API_URL?.trim() || null;
  const now = new Date();

  return prisma.project.upsert({
    where: { slug: projectSlug },
    update: {
      name: "Noble Express",
      clientName: "Noble Express",
      environment: "production",
      organizationId: orgId,
      monitoringEnabled: true,
      monitoringStartedAt: now,
      isActive: true,
      updatedAt: now,
      ...(frontendUrl ? { frontendUrl } : {}),
      ...(backendUrl ? { backendUrl } : {})
    },
    create: {
      id: randomUUID(),
      name: "Noble Express",
      slug: projectSlug,
      clientName: "Noble Express",
      environment: "production",
      organizationId: orgId,
      monitoringEnabled: true,
      monitoringStartedAt: now,
      isActive: true,
      status: "UNKNOWN",
      healthReason: "Awaiting first live heartbeat",
      healthSource: "noble-setup",
      automationMode: "OBSERVE",
      apiKey: generateApiKey(),
      signingSecret: generateSigningSecret(),
      frontendUrl,
      backendUrl,
      updatedAt: now
    }
  });
}

async function createNobleApiKey(orgId: string, projectId: string) {
  const existing = await prisma.orgApiKey.findFirst({
    where: {
      organizationId: orgId,
      projectId,
      revokedAt: null,
      name: "Noble Express live ingest"
    }
  });
  if (existing) {
    return { reused: true as const, keyId: existing.keyId };
  }

  const keyId = `ow_${randomBytes(6).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  await prisma.orgApiKey.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      projectId,
      name: "Noble Express live ingest",
      keyId,
      secretHash: sha256(secret),
      scopes: ["events:write", "heartbeats:write"],
      environment: "live"
    }
  });

  return { reused: false as const, keyId, key: `${keyId}.${secret}` };
}

async function main(): Promise<void> {
  const org = await resolveCanonicalOrg();
  const [movedProjects, movedUsers] = await Promise.all([
    prisma.project.updateMany({
      where: { organizationId: { not: org.id } },
      data: { organizationId: org.id, updatedAt: new Date() }
    }),
    prisma.user.updateMany({
      where: { organizationId: { not: org.id } },
      data: { organizationId: org.id, updatedAt: new Date() }
    })
  ]);

  const admin = await prisma.user.findFirst({
    where: { email: { equals: adminEmail, mode: "insensitive" } }
  });
  if (admin) {
    await prisma.user.update({
      where: { id: admin.id },
      data: { organizationId: org.id, role: "ADMIN", isActive: true, updatedAt: new Date() }
    });
  }

  const project = await ensureNobleProject(org.id);
  const graph = await seedNobleExpressGraph(prisma);
  const apiKey = await createNobleApiKey(org.id, project.id);

  console.log("NOBLE_SETUP_COMPLETE");
  console.log("ORG", org.slug, org.id);
  console.log("MOVED_PROJECTS", movedProjects.count);
  console.log("MOVED_USERS", movedUsers.count);
  console.log("PROJECT", project.slug, project.id);
  console.log("GRAPH", graph);
  console.log("SIGNING_SECRET", project.signingSecret);
  if (apiKey.reused) {
    console.log("API_KEY", `Reusing existing key ${apiKey.keyId}. Create a new key in /org if you need the secret.`);
  } else {
    console.log("API_KEY", apiKey.key);
  }

  if (process.env.NOBLE_SEND_BOOT_HEARTBEAT === "true") {
    requireEnv("OPSWATCH_API_URL");
    requireEnv("NOBLE_API_KEY");
    console.log("Run: pnpm monitoring:noble-live");
  }
}

main()
  .catch((error) => {
    console.error("NOBLE_SETUP_FAILED", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
