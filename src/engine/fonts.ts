/**
 * Bundled fonts. The browser preview and the Node exporter load the *same* woff2 files from
 * the @fontsource packages so that text metrics match between preview and export.
 */
import type { Brand } from '../project/schema';
import { FONT_FAMILIES } from '../project/schema';

export type FontFamily = (typeof FONT_FAMILIES)[number];

export interface FontFace {
  family: FontFamily;
  weight: number;
  /** npm package directory under node_modules/@fontsource */
  pkg: string;
  /** woff2 file name inside the package's files/ directory */
  file: string;
}

const FAMILY_PACKAGES: Record<FontFamily, { pkg: string; weights: number[] }> = {
  Inter: { pkg: 'inter', weights: [400, 500, 600, 700, 800] },
  'Space Grotesk': { pkg: 'space-grotesk', weights: [400, 500, 600, 700] },
  'Playfair Display': { pkg: 'playfair-display', weights: [400, 500, 600, 700, 800] },
};

export const FONT_FACES: FontFace[] = (Object.keys(FAMILY_PACKAGES) as FontFamily[]).flatMap((family) => {
  const { pkg, weights } = FAMILY_PACKAGES[family];
  return weights.map((weight) => ({ family, weight, pkg, file: `${pkg}-latin-${weight}-normal.woff2` }));
});

/** Nearest available weight for a family (e.g. Space Grotesk has no 800). */
export function resolveWeight(family: FontFamily, weight: number): number {
  const weights = FAMILY_PACKAGES[family].weights;
  return weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0]!);
}

export function resolveFamily(font: string, brand: Brand): FontFamily {
  if (font === '@heading') return brand.headingFont;
  if (font === '@body') return brand.bodyFont;
  return font as FontFamily;
}

/** CSS font shorthand. Family names are quoted; a generic fallback keeps text visible if loading fails. */
export function cssFont(family: FontFamily, weight: number, sizePx: number): string {
  return `${resolveWeight(family, weight)} ${sizePx}px "${family}", sans-serif`;
}
