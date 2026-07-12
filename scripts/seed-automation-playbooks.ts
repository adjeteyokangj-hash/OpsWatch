import { PrismaClient } from "@prisma/client";
import { seedAutomationPlaybooks } from "./lib/automation-playbooks.seed";

const prisma = new PrismaClient();

const main = async (): Promise<void> => {
  await seedAutomationPlaybooks(prisma);
  const count = await prisma.automationPlaybook.count();
  console.log("AUTOMATION_PLAYBOOKS_READY", { playbookCount: count });
};

void main()
  .catch((error) => {
    console.error("AUTOMATION_PLAYBOOKS_FAILED", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
