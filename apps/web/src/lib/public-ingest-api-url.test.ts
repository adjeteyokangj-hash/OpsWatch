import { afterEach, describe, expect, it } from "vitest";
import { resolvePublicIngestApiUrl } from "./public-ingest-api-url";

describe("resolvePublicIngestApiUrl", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it("prefers absolute NEXT_PUBLIC_OPSWATCH_INGEST_API_URL", () => {
    process.env.NEXT_PUBLIC_OPSWATCH_INGEST_API_URL = "https://opswatch.okanggroup.com";
    expect(resolvePublicIngestApiUrl()).toBe("https://opswatch.okanggroup.com/api");
  });

  it("keeps an /api suffix when already present", () => {
    process.env.NEXT_PUBLIC_OPSWATCH_INGEST_API_URL = "https://opswatch.okanggroup.com/api/";
    expect(resolvePublicIngestApiUrl()).toBe("https://opswatch.okanggroup.com/api");
  });
});
