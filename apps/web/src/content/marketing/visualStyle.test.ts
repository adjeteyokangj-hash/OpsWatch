import { describe, expect, it } from "vitest";
import { sanitizeVisualStyle, visualStyleToCss } from "./visualStyle";

describe("marketing visualStyle sanitizer", () => {
  it("allows approved tokens", () => {
    const safe = sanitizeVisualStyle({
      fontSize: "1.5rem",
      fontWeight: "700",
      color: "#112233",
      textAlign: "center",
      boxShadow: "0 8px 24px rgba(0,0,0,0.18)"
    });
    expect(safe?.fontSize).toBe("1.5rem");
    expect(safe?.color).toBe("#112233");
    const css = visualStyleToCss(safe);
    expect(css?.fontSize).toBe("1.5rem");
    expect(css?.color).toBe("#112233");
  });

  it("rejects CSS injection attempts", () => {
    expect(
      sanitizeVisualStyle({
        color: "red; background:url(javascript:alert(1))",
        fontFamily: "Arial",
        backgroundGradient: 'url("https://evil.example/x.png")',
        padding: "1rem; position:fixed"
      })
    ).toBeUndefined();
  });

  it("rejects unknown font families and sizes", () => {
    expect(sanitizeVisualStyle({ fontFamily: "Comic Sans MS", fontSize: "99vw" })).toBeUndefined();
  });
});
