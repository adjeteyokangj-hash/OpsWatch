import { prisma } from "../lib/prisma";

export const transitionMaintenanceWindowStatuses = async (): Promise<{
  activated: number;
  completed: number;
}> => {
  const now = new Date();
  const activated = await prisma.maintenanceWindow.updateMany({
    where: { status: "SCHEDULED", startsAt: { lte: now }, endsAt: { gte: now } },
    data: { status: "ACTIVE", updatedAt: now }
  });
  const completed = await prisma.maintenanceWindow.updateMany({
    where: {
      status: { in: ["SCHEDULED", "ACTIVE"] },
      endsAt: { lt: now }
    },
    data: { status: "COMPLETED", updatedAt: now }
  });
  return { activated: activated.count, completed: completed.count };
};

export const runMaintenanceWindowTransitionsJob = async (): Promise<void> => {
  const result = await transitionMaintenanceWindowStatuses();
  if (result.activated > 0 || result.completed > 0) {
    console.info(
      `[maintenance-windows] activated=${result.activated} completed=${result.completed}`
    );
  }
};
