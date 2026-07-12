import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import { acceptIngestNonce } from "./ingest-replay.service";

const enabled = process.env.RUN_DATABASE_E2E === "true";

describe.runIf(enabled)("ingest replay database e2e", () => {
  const nonce = `concurrent-${randomUUID()}`;

  afterAll(async () => {
    await prisma.ingestReplayNonce.deleteMany({ where: { nonce } });
  });

  it("accepts only one concurrent replay attempt for the same nonce", async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        acceptIngestNonce({ nonce, route: "heartbeat", projectId: randomUUID(), ttlSeconds: 60 })
      )
    );

    expect(attempts.filter((result) => result === "accepted")).toHaveLength(1);
    expect(attempts.filter((result) => result === "replay")).toHaveLength(7);
  });
});
