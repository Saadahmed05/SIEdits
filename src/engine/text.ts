import type { Ctx2D } from './types';

export interface TextLine {
  text: string;
  width: number;
}

/** Width of a string with extra letter spacing (px) between characters. */
export function measureSpaced(ctx: Ctx2D, text: string, spacingPx: number): number {
  if (spacingPx === 0 || text.length < 2) return ctx.measureText(text).width;
  let width = 0;
  for (const ch of text) width += ctx.measureText(ch).width;
  return width + spacingPx * (Array.from(text).length - 1);
}

/**
 * Greedy word wrap. Explicit newlines are honoured; words longer than the line are kept whole
 * (they overflow rather than being split mid-word). `ctx.font` must already be set.
 */
export function wrapText(ctx: Ctx2D, text: string, maxWidthPx: number, spacingPx: number): TextLine[] {
  const lines: TextLine[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push({ text: '', width: 0 });
      continue;
    }
    let current = words[0]!;
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (measureSpaced(ctx, candidate, spacingPx) <= maxWidthPx) current = candidate;
      else {
        lines.push({ text: current, width: measureSpaced(ctx, current, spacingPx) });
        current = word;
      }
    }
    lines.push({ text: current, width: measureSpaced(ctx, current, spacingPx) });
  }
  return lines;
}

/** Draw text starting at x (left edge) on baseline y, with optional letter spacing. */
export function fillSpaced(ctx: Ctx2D, text: string, x: number, y: number, spacingPx: number): void {
  if (spacingPx === 0) {
    ctx.fillText(text, x, y);
    return;
  }
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + spacingPx;
  }
}
