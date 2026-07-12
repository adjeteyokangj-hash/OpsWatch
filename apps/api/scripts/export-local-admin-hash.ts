import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const email = process.argv[2] ?? "admin@opswatch.local";

async function main(): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      email: true,
      passwordHash: true,
      role: true,
      isActive: true,
      organizationId: true
    }
  });

  if (!user) {
    console.log(`LOCAL_USER_NOT_FOUND: ${email}`);
    return;
  }

  const org = user.organizationId
    ? await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { id: true, slug: true }
      })
    : null;

  console.log("EMAIL", user.email);
  console.log("HASH_LENGTH", user.passwordHash.length);
  console.log("HASH", user.passwordHash);
  console.log("ORG_ID", org?.id ?? user.organizationId ?? "MISSING");
  console.log("ORG_SLUG", org?.slug ?? "unknown");
}

main()
  .catch((error) => {
    console.error("ERR", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
