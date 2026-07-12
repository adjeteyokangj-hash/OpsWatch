import { createHash } from "crypto";
import express from "express";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const password = "password";

const state = vi.hoisted(() => {
  const passwordHash = "$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi";
  return {
    passwordHash,
    sessions: new Map<
      string,
      {
        id: string;
        userId: string;
        tokenHash: string;
        csrfTokenHash: string;
        expiresAt: Date;
        idleExpiresAt: Date;
        lastSeenAt: Date;
        revokedAt: Date | null;
      }
    >(),
    users: new Map([
      [
        "user-1",
        {
          id: "user-1",
          email: "admin@example.com",
          role: "ADMIN",
          organizationId: "org-1",
          name: "Admin",
          passwordHash,
          isActive: true
        }
      ]
    ])
  };
});

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

vi.mock("../lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.email) {
          return [...state.users.values()].find((user) => user.email === where.email) ?? null;
        }
        return state.users.get(where.id) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        const email = where?.email?.equals?.toLowerCase?.() ?? where?.email;
        if (typeof email === "string") {
          return (
            [...state.users.values()].find(
              (user) => user.email.toLowerCase() === email.toLowerCase()
            ) ?? null
          );
        }
        return null;
      }),
      update: vi.fn()
    },
    userSession: {
      create: vi.fn(async ({ data }: any) => {
        state.sessions.set(data.id, {
          id: data.id,
          userId: data.userId,
          tokenHash: data.tokenHash,
          csrfTokenHash: data.csrfTokenHash,
          expiresAt: data.expiresAt,
          idleExpiresAt: data.idleExpiresAt,
          lastSeenAt: data.lastSeenAt ?? data.createdAt ?? new Date(),
          revokedAt: null
        });
        return data;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const row = [...state.sessions.values()].find((session) => session.tokenHash === where.tokenHash);
        if (!row) return null;
        const user = state.users.get(row.userId);
        if (!user) return null;
        return {
          ...row,
          User: include?.User?.select
            ? {
                id: user.id,
                email: user.email,
                role: user.role,
                organizationId: user.organizationId,
                name: user.name,
                isActive: user.isActive
              }
            : user
        };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.sessions.get(where.id);
        if (!row) return null;
        Object.assign(row, data);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const session of state.sessions.values()) {
          if (where.userId && session.userId !== where.userId) continue;
          if (where.tokenHash && session.tokenHash !== where.tokenHash) continue;
          if (where.revokedAt === null && session.revokedAt) continue;
          session.revokedAt = data.revokedAt;
          count += 1;
        }
        return { count };
      })
    },
    auditLog: { create: vi.fn() }
  }
}));

import { authRouter } from "../routes/auth.routes";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  return app;
};

const request = async (
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; csrf?: string } = {}
) => {
  const app = buildApp();
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (options.cookie) headers.Cookie = options.cookie;
    if (options.csrf) headers["x-opswatch-csrf"] = options.csrf;

    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } finally {
    server.close();
  }
};

const parseSetCookies = (response: Response): Record<string, string> => {
  const cookies: Record<string, string> = {};
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const separator = pair.indexOf("=");
    cookies[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
  return cookies;
};

describe("server-managed sessions", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    state.sessions.clear();
    process.env = {
      ...originalEnv,
      SESSION_SIGNING_REQUIRED: "true",
      SESSION_ABSOLUTE_TTL_SECONDS: "43200",
      SESSION_IDLE_TTL_SECONDS: "1800",
      NODE_ENV: "production"
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("issues secure HttpOnly session cookies on login", async () => {
    const response = await request("POST", "/auth/login", {
      body: { email: "admin@example.com", password }
    });

    expect(response.status).toBe(200);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((row) => row.startsWith("opswatch_session=") && row.includes("HttpOnly"))).toBe(true);
    expect(setCookies.some((row) => row.startsWith("opswatch_csrf=") && !row.includes("HttpOnly"))).toBe(true);
    expect(setCookies.every((row) => row.includes("Secure"))).toBe(true);
  });

  it("scopes session cookies to the parent domain for cross-subdomain deployments", async () => {
    process.env.OPSWATCH_WEB_URL = "https://opswatch.okanggroup.com";
    delete process.env.OPSWATCH_COOKIE_DOMAIN;

    const response = await request("POST", "/auth/login", {
      body: { email: "admin@example.com", password }
    });

    const setCookies = response.headers.getSetCookie();
    expect(setCookies.every((row) => row.includes("Domain=.okanggroup.com"))).toBe(true);
  });

  it("rejects state-changing requests without CSRF headers", async () => {
    const loginResponse = await request("POST", "/auth/login", {
      body: { email: "admin@example.com", password }
    });
    const cookies = parseSetCookies(loginResponse);
    const cookieHeader = `opswatch_session=${cookies.opswatch_session}; opswatch_csrf=${cookies.opswatch_csrf}`;

    const logoutResponse = await request("POST", "/auth/logout", {
      cookie: cookieHeader
    });

    expect(logoutResponse.status).toBe(403);
  });

  it("allows logout with matching CSRF token and invalidates the session", async () => {
    const loginResponse = await request("POST", "/auth/login", {
      body: { email: "admin@example.com", password }
    });
    const cookies = parseSetCookies(loginResponse);
    const cookieHeader = `opswatch_session=${cookies.opswatch_session}; opswatch_csrf=${cookies.opswatch_csrf}`;

    const logoutResponse = await request("POST", "/auth/logout", {
      cookie: cookieHeader,
      csrf: cookies.opswatch_csrf
    });
    expect(logoutResponse.status).toBe(204);

    const sessionResponse = await request("GET", "/auth/session", {
      cookie: cookieHeader
    });
    expect(sessionResponse.status).toBe(401);
  });

  it("disables cookie session authentication when SESSION_SIGNING_REQUIRED=false", async () => {
    process.env.SESSION_SIGNING_REQUIRED = "false";

    const loginResponse = await request("POST", "/auth/login", {
      body: { email: "admin@example.com", password }
    });
    expect(loginResponse.status).toBe(200);

    const cookies = parseSetCookies(loginResponse);
    const cookieHeader = `opswatch_session=${cookies.opswatch_session}; opswatch_csrf=${cookies.opswatch_csrf}`;
    const sessionResponse = await request("GET", "/auth/session", { cookie: cookieHeader });
    expect(sessionResponse.status).toBe(401);
  });

  it("creates a fresh session on each login to prevent fixation", async () => {
    const first = await request("POST", "/auth/login", {
      body: { email: "admin@example.com", password }
    });
    const firstCookies = parseSetCookies(first);

    const second = await request("POST", "/auth/login", {
      body: { email: "admin@example.com", password }
    });
    const secondCookies = parseSetCookies(second);

    expect(firstCookies.opswatch_session).toBeTruthy();
    expect(secondCookies.opswatch_session).toBeTruthy();
    expect(secondCookies.opswatch_session).not.toBe(firstCookies.opswatch_session);
  });
});
