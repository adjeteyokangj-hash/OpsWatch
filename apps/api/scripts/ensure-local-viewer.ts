/**
 * Creates or updates a local VIEWER user for access-control verification.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const prisma = new PrismaClient();
const VIEWER_EMAIL = "viewer@opswatch.local";
const VIEWER_PASSWORD = "OpsWatch!2026#ViewerOnly";

async function main() {
  const org = await prisma.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    throw new Error("No organization found. Run db:seed first.");
  }

  const passwordHash = await bcrypt.hash(VIEWER_PASSWORD, 10);
  const user = await prisma.user.upsert({
    where: { email: VIEWER_EMAIL },
    update: {
      role: "VIEWER",
      isActive: true,
      organizationId: org.id,
      passwordHash,
      updatedAt: new Date()
    },
    create: {
      id: randomUUID(),
      email: VIEWER_EMAIL,
      name: "Viewer",
      role: "VIEWER",
      isActive: true,
      organizationId: org.id,
      passwordHash,
      updatedAt: new Date()
    }
  });

  console.log(
    JSON.stringify({
      createdOrUpdated: user.email,
      role: user.role,
      organizationId: user.organizationId,
      passwordConfigured: true
    })
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
