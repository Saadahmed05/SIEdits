import { BRAND_TOKENS, type Brand, type BrandToken } from './schema';

/** Resolve a color value (hex or @token) to a hex string using the project's brand. */
export function resolveColor(value: string, brand: Brand): string {
  if (value.startsWith('@')) {
    const token = value.slice(1) as BrandToken;
    if ((BRAND_TOKENS as readonly string[]).includes(token)) return brand[token];
  }
  return value;
}

export function parseHex(hex: string): { r: number; g: number; b: number; a: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** CSS rgba() string with an additional alpha multiplier. */
export function rgba(hex: string, alpha = 1): string {
  const { r, g, b, a } = parseHex(hex);
  return `rgba(${r},${g},${b},${+(a * alpha).toFixed(4)})`;
}

/** Mix two hex colors; t=0 → a, t=1 → b. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
}

/** Relative luminance (WCAG) in [0, 1]. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
