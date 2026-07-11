import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, changePassword } from "./auth.service";

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn()
  },
  auditLog: {
    create: vi.fn()
  }
}));

vi.mock("../lib/prisma", () => ({
  prisma: prismaMock
}));

describe("changePassword", () => {
  const currentHash = bcrypt.hashSync("CurrentPassword123!", 10);

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "admin@okanggroup.com",
      passwordHash: currentHash,
      isActive: true
    });
    prismaMock.user.update.mockResolvedValue({});
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  it("updates password hash when current password is valid", async () => {
    await changePassword("user-1", "CurrentPassword123!", "NewSecurePassword99!");

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: expect.objectContaining({
        passwordHash: expect.any(String),
        updatedAt: expect.any(Date)
      })
    });

    const updateCall = prismaMock.user.update.mock.calls[0]?.[0];
    expect(updateCall).toBeDefined();
    const updatedHash = updateCall!.data.passwordHash as string;
    expect(await bcrypt.compare("NewSecurePassword99!", updatedHash)).toBe(true);
    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "PASSWORD_CHANGED",
        entityType: "USER",
        entityId: "user-1"
      })
    });
  });

  it("rejects an incorrect current password", async () => {
    await expect(
      changePassword("user-1", "WrongPassword123!!", "NewSecurePassword99!")
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects passwords below minimum strength", async () => {
    await expect(
      changePassword("user-1", "CurrentPassword123!", "short")
    ).rejects.toThrow(/at least 16 characters/);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("rejects reuse of the current password", async () => {
    await expect(
      changePassword("user-1", "CurrentPassword123!", "CurrentPassword123!")
    ).rejects.toMatchObject({ code: "PASSWORD_REUSE" });

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
