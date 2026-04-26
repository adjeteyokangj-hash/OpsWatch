import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { prisma } from "../apps/api/src/lib/prisma";

const ORG_ID = "7e9c1f02-e15a-48e4-a70e-1348427285db";
const EMAIL = "smoke.opswatch@example.com";
const PASSWORD = "SmokeTest123!";

(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  const user = existing
    ? await prisma.user.update({
        where: { email: EMAIL },
        data: { passwordHash, isActive: true, organizationId: ORG_ID, role: "ADMIN", updatedAt: new Date() }
      })
    : await prisma.user.create({
        data: {
          id: randomUUID(),
          email: EMAIL,
          name: "OpsWatch Smoke User",
          passwordHash,
          organizationId: ORG_ID,
          role: "ADMIN",
          updatedAt: new Date()
        }
      });
  console.log(JSON.stringify({ orgId: ORG_ID, userId: user.id, email: EMAIL, password: PASSWORD }));
  await prisma.$disconnect();
})();
