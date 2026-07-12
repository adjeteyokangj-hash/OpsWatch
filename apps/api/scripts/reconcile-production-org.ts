import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@okanggroup.com";

async function main(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    include: { _count: { select: { Project: true, User: true } } },
    orderBy: { Project: { _count: "desc" } }
  });

  if (orgs.length === 0) {
    throw new Error("No organizations found in database");
  }

  const canonical = orgs[0]!;
  const user = await prisma.user.findFirst({
    where: { email: { equals: adminEmail, mode: "insensitive" } }
  });

  if (!user) {
    throw new Error(`Administrator not found: ${adminEmail}`);
  }

  const [movedProjects, movedUsers] = await Promise.all([
    prisma.project.updateMany({
      where: { organizationId: { not: canonical.id } },
      data: { organizationId: canonical.id, updatedAt: new Date() }
    }),
    prisma.user.updateMany({
      where: { organizationId: { not: canonical.id } },
      data: { organizationId: canonical.id, updatedAt: new Date() }
    })
  ]);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      organizationId: canonical.id,
      role: "ADMIN",
      isActive: true,
      updatedAt: new Date()
    }
  });

  const [projectCount, alertCount, incidentCount] = await Promise.all([
    prisma.project.count({ where: { organizationId: canonical.id } }),
    prisma.alert.count({ where: { Project: { organizationId: canonical.id } } }),
    prisma.incident.count({ where: { Project: { organizationId: canonical.id } } })
  ]);

  console.log("CANONICAL_ORG", canonical.slug, canonical.id);
  console.log("ADMIN", user.email, user.id);
  console.log("MOVED_PROJECTS", movedProjects.count);
  console.log("MOVED_USERS", movedUsers.count);
  console.log("COUNTS", { projectCount, alertCount, incidentCount });
}

main()
  .catch((error) => {
    console.error("RECONCILE_ERROR", error instanceof Error ? error.message : error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
