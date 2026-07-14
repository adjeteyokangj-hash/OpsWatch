import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const project = await prisma.project.findUnique({
    where: { slug: process.env.NOBLE_EXPRESS_PROJECT_SLUG?.trim() || "noble-express" },
    select: { id: true, name: true }
  });
  if (!project) {
    throw new Error("Project not found");
  }
  const result = await prisma.service.updateMany({
    where: { projectId: project.id, name: "Customer Portal" },
    data: { baseUrl: "https://www.noblexp.com", updatedAt: new Date() }
  });
  console.log(JSON.stringify({ projectId: project.id, updated: result.count, baseUrl: "https://www.noblexp.com" }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
