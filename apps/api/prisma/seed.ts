import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();

async function main() {
  const orgId = randomUUID();
  const userId = randomUUID();

  const org = await prisma.organization.upsert({
    where: { slug: "opswatch-default" },
    update: {},
    create: {
      id: orgId,
      name: "OpsWatch",
      slug: "opswatch-default",
      updatedAt: new Date(),
    },
  });

  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  const user = await prisma.user.upsert({
    where: { email: "admin@opswatch.local" },
    update: {},
    create: {
      id: userId,
      name: "Admin",
      email: "admin@opswatch.local",
      passwordHash,
      role: "ADMIN",
      isActive: true,
      organizationId: org.id,
      updatedAt: new Date(),
    },
  });

  console.log(`Seeded org: ${org.id} | user: ${user.id} (${user.email})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
