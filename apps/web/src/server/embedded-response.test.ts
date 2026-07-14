import { describe, expect, it } from "vitest";
import { resolveEmbeddedResponseBody } from "./embedded-response";

describe("resolveEmbeddedResponseBody", () => {
  it("omits body for 204/205/304 so NextResponse can construct", () => {
    expect(resolveEmbeddedResponseBody(204, "")).toBeNull();
    expect(resolveEmbeddedResponseBody(205, "")).toBeNull();
    expect(resolveEmbeddedResponseBody(304, "")).toBeNull();
    expect(() => new Response(null, { status: 204 })).not.toThrow();
    expect(() => new Response("", { status: 204 })).toThrow();
  });

  it("keeps bodies for normal statuses", () => {
    expect(resolveEmbeddedResponseBody(202, '{"ok":true}')).toBe('{"ok":true}');
    expect(resolveEmbeddedResponseBody(400, '{"error":"x"}')).toBe('{"error":"x"}');
  });
});
