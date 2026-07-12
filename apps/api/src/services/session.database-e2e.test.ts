import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import {
  createUserSession,
  expireSessionForTest,
  revokeAllUserSessions,
  validateSessionToken
} from "./session.service";

const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("session database e2e", () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  let sessionToken = "";
  let sessionId = "";

  beforeAll(async () => {
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: "Session E2E Org",
        slug: `session-e2e-${organizationId}`,
        updatedAt: new Date()
      }
    });
    await prisma.user.create({
      data: {
        id: userId,
        name: "Session User",
        email: `session-${userId}@example.com`,
        passwordHash: bcrypt.hashSync("Password123!Secure", 10),
        role: "ADMIN",
        organizationId,
        updatedAt: new Date()
      }
    });

    const created = await createUserSession({ userId });
    sessionToken = created.sessionToken;
    sessionId = created.sessionId;
  });

  afterAll(async () => {
    await prisma.userSession.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
  });

  it("validates active sessions and rejects idle-expired sessions", async () => {
    expect(await validateSessionToken(sessionToken)).not.toBeNull();

    await expireSessionForTest(sessionId, true);
    expect(await validateSessionToken(sessionToken)).toBeNull();
  });

  it("revokes all sessions for a user", async () => {
    const fresh = await createUserSession({ userId });
    expect(await validateSessionToken(fresh.sessionToken)).not.toBeNull();

    await revokeAllUserSessions(userId, "COMPROMISED");
    expect(await validateSessionToken(fresh.sessionToken)).toBeNull();
  });
});
