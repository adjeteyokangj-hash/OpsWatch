import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

const LOCAL_DEV_DEFAULT_EMAIL = "admin@opswatch.local";
const LOCAL_DEV_DEFAULT_PASSWORD = "OpsWatch!2026#LocalDevOnly";
const MIN_SEED_PASSWORD_LENGTH = 16;

const assertSeedPasswordStrength = (password: string): void => {
  if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_SEED_PASSWORD_LENGTH} characters`);
  }
};

const resolveDevPassword = (adminPassword: string | undefined, existingUser: boolean): string => {
  if (adminPassword) {
    return adminPassword;
  }
  if (existingUser) {
    return LOCAL_DEV_DEFAULT_PASSWORD;
  }
  return LOCAL_DEV_DEFAULT_PASSWORD;
};

async function resolveSeedOrganization(isProduction: boolean) {
  if (isProduction) {
    return prisma.organization.upsert({
      where: { slug: "opswatch-default" },
      update: {},
      create: {
        id: randomUUID(),
        name: "OpsWatch",
        slug: "opswatch-default",
        updatedAt: new Date()
      }
    });
  }

  const preferred = await prisma.organization.findFirst({
    where: { slug: { in: ["okanggroup", "opswatch-default"] } },
    orderBy: { Project: { _count: "desc" } },
    include: { _count: { select: { Project: true } } }
  });

  if (preferred) {
    return preferred;
  }

  return prisma.organization.create({
    data: {
      id: randomUUID(),
      name: "OpsWatch",
      slug: "opswatch-default",
      updatedAt: new Date()
    }
  });
}

async function main() {
  const isProduction = process.env.NODE_ENV === "production";
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? (isProduction ? undefined : LOCAL_DEV_DEFAULT_EMAIL);
  const adminPassword = process.env.SEED_ADMIN_PASSWORD?.trim() || undefined;

  if (!adminEmail) {
    throw new Error("SEED_ADMIN_EMAIL is required when seeding in production");
  }

  const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (isProduction && !existingUser && !adminPassword) {
    throw new Error(
      "SEED_ADMIN_PASSWORD is required when creating the production administrator. " +
        "To update an existing administrator without changing the password, omit SEED_ADMIN_PASSWORD."
    );
  }

  if (adminPassword) {
    assertSeedPasswordStrength(adminPassword);
  }

  const resolvedPassword = resolveDevPassword(adminPassword, Boolean(existingUser));
  if (!adminPassword && !existingUser && !isProduction) {
    console.warn(
      "SEED_ADMIN_PASSWORD not set — using local development default. Do not use in production."
    );
  }

  const org = await resolveSeedOrganization(isProduction);
  const passwordHash = await bcrypt.hash(resolvedPassword, 10);

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Admin",
      role: "ADMIN",
      isActive: true,
      organizationId: org.id,
      updatedAt: new Date(),
      ...(adminPassword || !isProduction ? { passwordHash } : {})
    },
    create: {
      id: randomUUID(),
      name: "Admin",
      email: adminEmail,
      passwordHash,
      role: "ADMIN",
      isActive: true,
      organizationId: org.id,
      updatedAt: new Date()
    }
  });

  const action = existingUser ? "Updated" : "Created";
  console.log(`${action} administrator: ${user.email} (${user.id}) in org ${org.slug}`);

  if (process.env.RUN_DATABASE_E2E === "true") {
    const nobleExpress = await prisma.project.upsert({
      where: { slug: "noble-express" },
      update: { organizationId: org.id, updatedAt: new Date() },
      create: {
        id: randomUUID(),
        name: "Noble Express",
        slug: "noble-express",
        clientName: "CI",
        environment: "test",
        apiKey: randomUUID(),
        signingSecret: randomUUID(),
        organizationId: org.id,
        updatedAt: new Date()
      }
    });
    const { seedNobleExpressGraph } = await import("../../../scripts/lib/noble-express-graph.seed");
    const graph = await seedNobleExpressGraph(prisma);
    console.log(
      `Seeded Noble Express graph (${graph.serviceCount} services, ${graph.dependencyCount} dependencies) for ${nobleExpress.slug}`
    );
  }

  if (!isProduction) {
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
    if (movedProjects.count > 0) {
      console.log(`Moved ${movedProjects.count} project(s) into org ${org.slug}`);
    }
    if (movedUsers.count > 0) {
      console.log(`Moved ${movedUsers.count} user(s) into org ${org.slug}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
