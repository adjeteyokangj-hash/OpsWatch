import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn()
}));

vi.mock("../lib/prisma", () => ({
  prisma: {
    ingestReplayNonce: {
      create: mockCreate
    }
  }
}));

import { acceptIngestNonce } from "./ingest-replay.service";

describe("ingest-replay.service", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a nonce once", async () => {
    mockCreate.mockResolvedValue({ nonce: "nonce-1" });

    await expect(
      acceptIngestNonce({ nonce: "nonce-1", route: "event", projectId: "project-1", apiKeyId: "key-1" })
    ).resolves.toBe("accepted");
  });

  it("detects replayed nonces from unique constraint failures", async () => {
    mockCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test"
      })
    );

    await expect(acceptIngestNonce({ nonce: "nonce-1", route: "heartbeat" })).resolves.toBe("replay");
  });
});
