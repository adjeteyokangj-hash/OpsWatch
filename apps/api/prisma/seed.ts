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

  let resolvedCreatePassword = adminPassword;
  if (!existingUser && !resolvedCreatePassword) {
    if (isProduction) {
      throw new Error("SEED_ADMIN_PASSWORD is required when creating the production administrator");
    }
    console.warn(
      "SEED_ADMIN_PASSWORD not set — using local development default. Do not use in production."
    );
    resolvedCreatePassword = LOCAL_DEV_DEFAULT_PASSWORD;
  }

  const org = await prisma.organization.upsert({
    where: { slug: "opswatch-default" },
    update: {},
    create: {
      id: randomUUID(),
      name: "OpsWatch",
      slug: "opswatch-default",
      updatedAt: new Date(),
    },
  });

  const updateData = {
    name: "Admin",
    role: "ADMIN",
    isActive: true,
    organizationId: org.id,
    updatedAt: new Date(),
    ...(adminPassword
      ? { passwordHash: await bcrypt.hash(adminPassword, 10) }
      : {}),
  };

  const user = await prisma.user.upsert({
    where: { email: adminEmail },
    update: updateData,
    create: {
      id: randomUUID(),
      name: "Admin",
      email: adminEmail,
      passwordHash: await bcrypt.hash(resolvedCreatePassword!, 10),
      role: "ADMIN",
      isActive: true,
      organizationId: org.id,
      updatedAt: new Date(),
    },
  });

  const action = existingUser ? "Updated" : "Created";
  console.log(`${action} administrator: ${user.email} (${user.id}) in org ${org.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
