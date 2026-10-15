import { describe, expect, it } from "vitest";
import { sanitizeMarketingImageUrl, sanitizePageVisualStyles, sanitizeVisualStyle, visualStyleToCss } from "./visualStyle";
import type { MarketingPageContent } from "./types";

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

  it("keeps https CMS images and drops unsafe URLs before render", () => {
    expect(sanitizeMarketingImageUrl("https://cdn.example.com/hero.png")).toBe(
      "https://cdn.example.com/hero.png"
    );
    expect(sanitizeMarketingImageUrl("http://cdn.example.com/hero.png")).toBeUndefined();
    expect(sanitizeMarketingImageUrl("javascript:alert(1)")).toBeUndefined();
    expect(sanitizeMarketingImageUrl("https://user:pass@cdn.example.com/a.png")).toBeUndefined();

    const page: MarketingPageContent = {
      slug: "home",
      cmsKey: "opswatch.page.home",
      metaTitle: "Home",
      metaDescription: "Home",
      hero: {
        eyebrow: "E",
        title: "T",
        subtitle: "S",
        style: { color: "#112233", fontSize: "99vw" },
        image: {
          url: "https://cdn.example.com/hero.png",
          alt: "Hero",
          style: { objectFit: "cover", color: "red; background:url(javascript:alert(1))" }
        }
      },
      sections: [
        {
          id: "capabilities",
          cmsKey: "opswatch.page.home.capabilities",
          title: "Caps",
          image: { url: "javascript:alert(1)", alt: "Bad" }
        }
      ]
    };

    const safe = sanitizePageVisualStyles(page);
    expect(safe.hero.style?.color).toBe("#112233");
    expect(safe.hero.style?.fontSize).toBeUndefined();
    expect(safe.hero.image?.url).toBe("https://cdn.example.com/hero.png");
    expect(safe.hero.image?.style?.objectFit).toBe("cover");
    expect(safe.hero.image?.style?.color).toBeUndefined();
    expect(safe.sections[0]?.image).toBeUndefined();
  });
});
