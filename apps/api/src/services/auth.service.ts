import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signJwt } from "../utils/jwt";

export const login = async (email: string, password: string): Promise<{ token: string }> => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    throw new Error("Invalid credentials");
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    throw new Error("Invalid credentials");
  }

  return {
    token: signJwt({
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId ?? undefined
    })
  };
};
