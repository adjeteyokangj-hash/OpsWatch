import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextRequire = createRequire(require.resolve("next/package.json"));
const sharp = nextRequire("sharp");

describe("Next image optimizer patched native dependency", () => {
  it.each(["jpeg", "webp", "avif"] as const)("resizes and round-trips %s with the sharp version used by Next", async format => {
    const image = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#2563eb" } })
      .resize(2, 2).toFormat(format).toBuffer();
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBe(2);
    expect(metadata.height).toBe(2);
    expect(metadata.format).toBe(format === "avif" ? "heif" : format);
  });
});
