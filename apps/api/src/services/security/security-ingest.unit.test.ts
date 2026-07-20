import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockRetentionFind = vi.fn();

vi.mock("../../lib/prisma", () => ({
  prisma: {
    securityEvent: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args)
    },
    retentionPolicy: {
      findUnique: (...args: unknown[]) => mockRetentionFind(...args)
    }
  }
}));

import {
  ingestSecurityEvents,
  validateSecurityEventTimestamp
} from "./security-ingest.service";
import { redactSecurityPayload, truncateIp, hashAccountIdentifier } from "./security-redaction";

describe("security redaction", () => {
  it("redacts passwords and tokens from payloads", () => {
    const { value, meta } = redactSecurityPayload({
      password: "super-secret",
      token: "abc",
      user: "alice",
      note: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb"
    });
    expect(value).toMatchObject({
      password: "[REDACTED]",
      token: "[REDACTED]",
      user: "alice"
    });
    expect(meta.fieldsRedacted.length).toBeGreaterThan(0);
    expect(JSON.stringify(value)).not.toContain("super-secret");
    expect(JSON.stringify(value)).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("truncates IPv4 addresses", () => {
    expect(truncateIp("203.0.113.45")).toBe("203.0.113.0");
  });

  it("hashes account identifiers", () => {
    const a = hashAccountIdentifier("org-1", "user@example.com");
    const b = hashAccountIdentifier("org-1", "user@example.com");
    const c = hashAccountIdentifier("org-2", "user@example.com");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("@");
  });
});

describe("security ingest", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockCreate.mockReset();
    mockRetentionFind.mockReset();
    mockRetentionFind.mockResolvedValue(null);
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockImplementation(async ({ data }: { data: { id: string } }) => data);
  });

  it("accepts a valid LOGIN_FAILED event and redacts sensitive payload", async () => {
    const result = await ingestSecurityEvents(
      [
        {
          eventType: "LOGIN_FAILED",
          severity: "HIGH",
          environment: "production",
          accountIdentifier: "alice@example.com",
          sourceIp: "198.51.100.22",
          idempotencyKey: "evt-1",
          payload: { password: "nope", reason: "bad_password" }
        }
      ],
      { organizationId: "org-1", providerSource: "test" }
    );

    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(mockCreate).toHaveBeenCalledOnce();
    const created = mockCreate.mock.calls[0][0].data;
    expect(created.eventType).toBe("LOGIN_FAILED");
    expect(created.payloadJson.password).toBe("[REDACTED]");
    expect(created.accountIdentifierHash).toBeTruthy();
    expect(created.sourceIpTruncated).toBe("198.51.100.0");
    expect(JSON.stringify(created)).not.toContain("nope");
    expect(JSON.stringify(created)).not.toContain("alice@example.com");
  });

  it("is idempotent for duplicate keys", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing-id" });
    const result = await ingestSecurityEvents(
      [
        {
          eventType: "INVALID_API_KEY",
          idempotencyKey: "dup-1"
        }
      ],
      { organizationId: "org-1" }
    );
    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ status: "accepted", id: "existing-id", duplicate: true });
  });

  it("rejects unsupported event types and far-future timestamps", async () => {
    const badType = await ingestSecurityEvents(
      [{ eventType: "NOT_A_REAL_EVENT" }],
      { organizationId: "org-1" }
    );
    expect(badType.rejected).toBe(1);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const badTs = await ingestSecurityEvents(
      [{ eventType: "LOGIN_FAILED", timestamp: future, idempotencyKey: "future-1" }],
      { organizationId: "org-1" }
    );
    expect(badTs.rejected).toBe(1);
    expect(badTs.results[0]).toMatchObject({ status: "rejected" });
  });

  it("rejects environment binding mismatches", async () => {
    const result = await ingestSecurityEvents(
      [{ eventType: "LOGIN_FAILED", environment: "staging", idempotencyKey: "env-1" }],
      { organizationId: "org-1", environmentBinding: "production" }
    );
    expect(result.rejected).toBe(1);
    expect(result.results[0]).toMatchObject({ error: "environment binding mismatch" });
  });

  it("validates timestamp windows", () => {
    const now = new Date("2026-07-20T12:00:00.000Z");
    expect(validateSecurityEventTimestamp(new Date("2026-07-20T12:05:00.000Z"), now)).toBeNull();
    expect(validateSecurityEventTimestamp(new Date("2026-07-20T13:00:00.000Z"), now)).toContain(
      "future"
    );
  });
});
