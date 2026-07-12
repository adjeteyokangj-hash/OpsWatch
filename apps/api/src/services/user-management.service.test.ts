import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCanChangeAdminAccess,
  consolidateDevOrganizationUsers,
  invitePlatformMember,
  listProjectContactEmails,
  UserManagementError
} from "./user-management.service";

const prismaMock = vi.hoisted(() => ({
  user: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    count: vi.fn()
  },
  organization: {
    findFirst: vi.fn()
  },
  project: {
    findMany: vi.fn()
  }
}));

vi.mock("../lib/prisma", () => ({
  prisma: prismaMock
}));

describe("user management safeguards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks demoting the last active admin", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      isActive: true
    });
    prismaMock.user.count.mockResolvedValue(1);

    await expect(assertCanChangeAdminAccess("org-1", "admin-1", { nextRole: "MEMBER" })).rejects.toBeInstanceOf(
      UserManagementError
    );
  });

  it("allows demoting an admin when another admin remains", async () => {
    prismaMock.user.findFirst.mockResolvedValue({
      id: "admin-1",
      role: "ADMIN",
      isActive: true
    });
    prismaMock.user.count.mockResolvedValue(2);

    await expect(assertCanChangeAdminAccess("org-1", "admin-1", { nextRole: "MEMBER" })).resolves.toBeUndefined();
  });
});

describe("invitePlatformMember", () => {
  const baseInput = {
    organizationId: "org-1",
    name: "Adjei",
    email: "member@example.com",
    role: "ADMIN",
    passwordHash: "hashed-password"
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a user when the email is new", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: "user-1",
      ...baseInput,
      isActive: true,
      createdAt: new Date("2026-07-10T00:00:00.000Z")
    });

    const result = await invitePlatformMember(baseInput);

    expect(result.outcome).toBe("created");
    expect(prismaMock.user.create).toHaveBeenCalledOnce();
  });

  it("returns the existing user when already in the organization", async () => {
    const existing = {
      id: "user-1",
      ...baseInput,
      isActive: true,
      createdAt: new Date("2026-07-10T00:00:00.000Z")
    };
    prismaMock.user.findUnique.mockResolvedValue(existing);

    const result = await invitePlatformMember(baseInput);

    expect(result.outcome).toBe("already_in_org");
    expect(result.user).toEqual(existing);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("reattaches a user from another organization", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: "user-1",
      name: "Old name",
      email: baseInput.email,
      role: "MEMBER",
      passwordHash: "old-hash",
      organizationId: "org-2",
      isActive: true,
      createdAt: new Date("2026-07-10T00:00:00.000Z")
    });
    prismaMock.user.update.mockResolvedValue({
      id: "user-1",
      ...baseInput,
      isActive: true,
      createdAt: new Date("2026-07-10T00:00:00.000Z")
    });

    const result = await invitePlatformMember(baseInput);

    expect(result.outcome).toBe("reattached");
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        organizationId: "org-1",
        name: "Adjei",
        role: "ADMIN",
        passwordHash: "hashed-password",
        isActive: true,
        updatedAt: expect.any(Date)
      }
    });
  });
});

describe("consolidateDevOrganizationUsers", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("does nothing in production", async () => {
    process.env.NODE_ENV = "production";
    const moved = await consolidateDevOrganizationUsers();
    expect(moved).toBe(0);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it("moves users into the preferred dev organization", async () => {
    process.env.NODE_ENV = "development";
    prismaMock.organization.findFirst.mockResolvedValue({ id: "org-okanggroup" });
    prismaMock.user.updateMany.mockResolvedValue({ count: 1 });

    const moved = await consolidateDevOrganizationUsers();

    expect(moved).toBe(1);
    expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
      where: { organizationId: { not: "org-okanggroup" } },
      data: { organizationId: "org-okanggroup", updatedAt: expect.any(Date) }
    });
  });
});

describe("listProjectContactEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns project owner, operational contact, and notification emails", async () => {
    prismaMock.project.findMany.mockResolvedValue([
      {
        id: "app-noble-express",
        name: "Noble Express",
        projectOwner: "Jane Smith",
        operationalContact: "ops@client.com",
        NotificationChannel: [{ target: "alerts@client.com" }]
      }
    ]);

    const rows = await listProjectContactEmails("org-okanggroup");

    expect(rows).toEqual([
      {
        projectId: "app-noble-express",
        projectName: "Noble Express",
        projectOwner: "Jane Smith",
        operationalContact: "ops@client.com",
        notificationEmails: ["alerts@client.com"]
      }
    ]);
  });
});
