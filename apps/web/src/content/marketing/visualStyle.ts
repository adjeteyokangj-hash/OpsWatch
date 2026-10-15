import type { CSSProperties } from "react";
import type { MarketingImage, MarketingPageContent } from "./types";

/**
 * Optional CMS visual overrides from OkangGroup Visual Studio.
 * Only allowlisted tokens are rendered — never raw author CSS strings.
 */
export type MarketingVisualStyle = {
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  lineHeight?: string;
  letterSpacing?: string;
  textAlign?: "left" | "center" | "right";
  color?: string;
  backgroundColor?: string;
  backgroundGradient?: string;
  borderColor?: string;
  borderWidth?: string;
  borderRadius?: string;
  opacity?: number;
  padding?: string;
  margin?: string;
  boxShadow?: string;
  objectFit?: "cover" | "contain" | "fill" | "none";
  objectPosition?: string;
  maxWidth?: string;
  width?: string;
  transition?: string;
};

const FONT_FAMILIES = new Set([
  '"Source Serif 4", Georgia, serif',
  '"IBM Plex Sans", "Segoe UI", sans-serif',
  '"DM Sans", "Segoe UI", sans-serif',
  'Georgia, "Times New Roman", serif',
  "ui-monospace, Consolas, monospace"
]);

const FONT_SIZES = new Set([
  "0.875rem",
  "1rem",
  "1.125rem",
  "1.25rem",
  "1.5rem",
  "1.875rem",
  "2.25rem",
  "3rem"
]);

const FONT_WEIGHTS = new Set(["400", "500", "600", "700"]);
const LINE_HEIGHTS = new Set(["1.2", "1.45", "1.7"]);
const LETTER_SPACINGS = new Set(["-0.02em", "0.02em", "0.08em"]);
const BORDER_WIDTHS = new Set(["1px", "2px", "4px"]);
const BORDER_RADII = new Set(["0", "6px", "12px", "999px"]);
const PADDINGS = new Set(["0.5rem", "1rem", "1.5rem", "2.5rem"]);
const MARGINS = new Set(["0", "0.5rem 0", "1rem 0", "2rem auto"]);
const SHADOWS = new Set([
  "0 1px 2px rgba(0,0,0,0.12)",
  "0 8px 24px rgba(0,0,0,0.18)",
  "0 16px 40px rgba(0,0,0,0.28)"
]);
const OBJECT_POSITIONS = new Set(["center", "top", "bottom", "left", "right"]);
const MAX_WIDTHS = new Set(["320px", "480px", "640px", "100%"]);
const WIDTHS = new Set(["100%", "auto"]);
const TRANSITIONS = new Set([
  "box-shadow 160ms ease, transform 160ms ease",
  "opacity 200ms ease"
]);

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/;

function isSafeToken(value: string): boolean {
  if (!value || value.length > 160) return false;
  if (/[;{}]|url\s*\(|expression\s*\(|javascript:|@import|<\/|\\/i.test(value)) return false;
  return true;
}

function isSafeColor(value: string): boolean {
  return isSafeToken(value) && (HEX.test(value) || RGB.test(value));
}

function isSafeGradient(value: string): boolean {
  if (!isSafeToken(value)) return false;
  if (!/^linear-gradient\(/i.test(value)) return false;
  if (/url\s*\(/i.test(value)) return false;
  return true;
}

/** Parse and allowlist a style object from CMS JSON (draft, preview, or published). */
export function sanitizeVisualStyle(raw: unknown): MarketingVisualStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;
  const out: MarketingVisualStyle = {};

  const pickSet = (key: keyof MarketingVisualStyle, allowed: Set<string>) => {
    const v = s[key];
    if (typeof v === "string" && allowed.has(v)) {
      (out as Record<string, string>)[key] = v;
    }
  };

  pickSet("fontFamily", FONT_FAMILIES);
  pickSet("fontSize", FONT_SIZES);
  pickSet("fontWeight", FONT_WEIGHTS);
  pickSet("lineHeight", LINE_HEIGHTS);
  pickSet("letterSpacing", LETTER_SPACINGS);
  pickSet("borderWidth", BORDER_WIDTHS);
  pickSet("borderRadius", BORDER_RADII);
  pickSet("padding", PADDINGS);
  pickSet("margin", MARGINS);
  pickSet("boxShadow", SHADOWS);
  pickSet("objectPosition", OBJECT_POSITIONS);
  pickSet("maxWidth", MAX_WIDTHS);
  pickSet("width", WIDTHS);
  pickSet("transition", TRANSITIONS);

  if (s.textAlign === "left" || s.textAlign === "center" || s.textAlign === "right") {
    out.textAlign = s.textAlign;
  }
  if (
    s.objectFit === "cover" ||
    s.objectFit === "contain" ||
    s.objectFit === "fill" ||
    s.objectFit === "none"
  ) {
    out.objectFit = s.objectFit;
  }
  if (typeof s.color === "string" && isSafeColor(s.color)) out.color = s.color;
  if (typeof s.backgroundColor === "string" && isSafeColor(s.backgroundColor)) {
    out.backgroundColor = s.backgroundColor;
  }
  if (typeof s.borderColor === "string" && isSafeColor(s.borderColor)) {
    out.borderColor = s.borderColor;
  }
  if (typeof s.backgroundGradient === "string" && isSafeGradient(s.backgroundGradient)) {
    out.backgroundGradient = s.backgroundGradient;
  }
  if (typeof s.opacity === "number" && Number.isFinite(s.opacity)) {
    out.opacity = Math.min(1, Math.max(0, s.opacity));
  }

  return Object.keys(out).length ? out : undefined;
}

/** Convert a sanitized style to React CSSProperties (no unsanitized passthrough). */
export function visualStyleToCss(style?: MarketingVisualStyle | null): CSSProperties | undefined {
  const safe = sanitizeVisualStyle(style);
  if (!safe) return undefined;
  const css: CSSProperties = {};
  if (safe.fontFamily) css.fontFamily = safe.fontFamily;
  if (safe.fontSize) css.fontSize = safe.fontSize;
  if (safe.fontWeight) css.fontWeight = safe.fontWeight;
  if (safe.lineHeight) css.lineHeight = safe.lineHeight;
  if (safe.letterSpacing) css.letterSpacing = safe.letterSpacing;
  if (safe.textAlign) css.textAlign = safe.textAlign;
  if (safe.color) css.color = safe.color;
  if (safe.backgroundGradient) css.backgroundImage = safe.backgroundGradient;
  else if (safe.backgroundColor) css.backgroundColor = safe.backgroundColor;
  if (safe.borderColor) css.borderColor = safe.borderColor;
  if (safe.borderWidth) {
    css.borderWidth = safe.borderWidth;
    css.borderStyle = "solid";
  }
  if (safe.borderRadius) css.borderRadius = safe.borderRadius;
  if (typeof safe.opacity === "number") css.opacity = safe.opacity;
  if (safe.padding) css.padding = safe.padding;
  if (safe.margin) css.margin = safe.margin;
  if (safe.boxShadow) css.boxShadow = safe.boxShadow;
  if (safe.maxWidth) css.maxWidth = safe.maxWidth;
  if (safe.width) css.width = safe.width;
  if (safe.objectFit) css.objectFit = safe.objectFit;
  if (safe.objectPosition) css.objectPosition = safe.objectPosition;
  if (safe.transition) css.transition = safe.transition;
  return Object.keys(css).length ? css : undefined;
}

/** Public CMS images must be absolute https URLs with no embedded credentials. */
export function sanitizeMarketingImageUrl(url: unknown): string | undefined {
  if (typeof url !== "string") return undefined;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2000) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  if (parsed.username || parsed.password) return undefined;
  return parsed.toString();
}

function sanitizeMarketingImage(image: MarketingImage | undefined): MarketingImage | undefined {
  if (!image) return undefined;
  const url = sanitizeMarketingImageUrl(image.url);
  if (!url) return undefined;
  return {
    url,
    alt: typeof image.alt === "string" ? image.alt.slice(0, 300) : "",
    storagePath: typeof image.storagePath === "string" ? image.storagePath.slice(0, 500) : undefined,
    style: sanitizeVisualStyle(image.style)
  };
}

/** Deep-sanitize style bags on a CMS page before render (preview or published). */
export function sanitizePageVisualStyles(page: MarketingPageContent): MarketingPageContent {
  const hero = {
    ...page.hero,
    style: sanitizeVisualStyle(page.hero.style),
    primaryCta: page.hero.primaryCta
      ? { ...page.hero.primaryCta, style: sanitizeVisualStyle(page.hero.primaryCta.style) }
      : undefined,
    secondaryCta: page.hero.secondaryCta
      ? { ...page.hero.secondaryCta, style: sanitizeVisualStyle(page.hero.secondaryCta.style) }
      : undefined,
    image: sanitizeMarketingImage(page.hero.image)
  };
  const sections = page.sections.map((section) => ({
    ...section,
    style: sanitizeVisualStyle(section.style),
    image: sanitizeMarketingImage(section.image),
    cards: (section.cards ?? []).map((card) => ({
      ...card,
      style: sanitizeVisualStyle(card.style)
    })),
    ctas: (section.ctas ?? []).map((cta) => ({
      ...cta,
      style: sanitizeVisualStyle(cta.style)
    }))
  }));
  return { ...page, hero, sections };
}
