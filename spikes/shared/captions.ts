/**
 * Word-highlight captions ("karaoke" style) drawn with Canvas 2D. Words are grouped into short
 * pages; the page under the playhead is drawn in the lower safe zone with the spoken word
 * highlighted. Pure function of (words, time), like the SceneWright engine.
 */
import type { Word } from './words';

export interface CaptionStyle {
  font: string;
  weight: number;
  /** Font size as a fraction of frame height. */
  size: number;
  fill: string;
  highlight: string;
  stroke: string;
  /** Stroke width in em. */
  strokeWidth: number;
  uppercase: boolean;
  /** Vertical centre of the caption block as a fraction of frame height. */
  y: number;
  /** Wrap width as a fraction of frame width. */
  maxWidth: number;
  maxWordsPerPage: number;
}

export const BOLD_POP: CaptionStyle = {
  font: 'Inter',
  weight: 800,
  size: 0.052,
  fill: '#ffffff',
  highlight: '#ffd43b',
  stroke: '#000000',
  strokeWidth: 0.16,
  uppercase: true,
  // Above the bottom ~25% that Reels/TikTok/Shorts cover with their own UI.
  y: 0.68,
  maxWidth: 0.82,
  maxWordsPerPage: 4,
};

export interface CaptionPage {
  words: Word[];
  start: number;
  end: number;
}

/** Split words into pages of at most `maxWords`, breaking early at pauses longer than `gap` s. */
export function paginate(words: readonly Word[], maxWords: number, gap = 0.6): CaptionPage[] {
  const pages: CaptionPage[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length) pages.push({ words: current, start: current[0]!.start, end: current[current.length - 1]!.end });
    current = [];
  };
  for (const word of words) {
    const prev = current[current.length - 1];
    if (current.length >= maxWords || (prev && word.start - prev.end > gap)) flush();
    current.push(word);
  }
  flush();
  return pages;
}

/** The page to show at time t: the active page, held until the next one starts (max 0.5 s). */
export function pageAt(pages: readonly CaptionPage[], t: number): CaptionPage | undefined {
  let lo = 0;
  let hi = pages.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid]!.start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const page = pages[found];
  if (!page) return undefined;
  const next = pages[found + 1];
  const holdUntil = Math.min(page.end + 0.5, next ? next.start : Infinity);
  return t < holdUntil ? page : undefined;
}

/** Draw the caption page for time t onto a W×H frame. */
export function drawCaptions(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  pages: readonly CaptionPage[],
  t: number,
  W: number,
  H: number,
  style: CaptionStyle = BOLD_POP,
): void {
  const page = pageAt(pages, t);
  if (!page) return;
  const px = style.size * H;
  ctx.save();
  ctx.font = `${style.weight} ${px}px "${style.font}"`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';

  const labels = page.words.map((w) => (style.uppercase ? w.text.toUpperCase() : w.text));
  // Skia's space advance is narrower than Chrome's; keep room for the highlight pop.
  const space = Math.max(ctx.measureText(' ').width, px * 0.3);
  const widths = labels.map((l) => ctx.measureText(l).width);

  // Greedy line wrap.
  const lines: number[][] = [];
  let line: number[] = [];
  let lineWidth = 0;
  widths.forEach((w, i) => {
    const added = line.length ? lineWidth + space + w : w;
    if (line.length && added > style.maxWidth * W) {
      lines.push(line);
      line = [i];
      lineWidth = w;
    } else {
      line.push(i);
      lineWidth = added;
    }
  });
  if (line.length) lines.push(line);

  const lineHeight = px * 1.15;
  let y = style.y * H - ((lines.length - 1) * lineHeight) / 2;
  for (const indices of lines) {
    const total = indices.reduce((sum, i, k) => sum + widths[i]! + (k ? space : 0), 0);
    let x = (W - total) / 2;
    for (const i of indices) {
      const word = page.words[i]!;
      const active = t >= word.start && t < Math.max(word.end, word.start + 0.12);
      // Small pop on the spoken word.
      const s = active ? 1 + 0.08 * Math.max(0, 1 - (t - word.start) / 0.15) : 1;
      ctx.save();
      ctx.translate(x + widths[i]! / 2, y);
      ctx.scale(s, s);
      ctx.lineWidth = style.strokeWidth * px;
      ctx.strokeStyle = style.stroke;
      ctx.strokeText(labels[i]!, -widths[i]! / 2, 0);
      ctx.fillStyle = active ? style.highlight : style.fill;
      ctx.fillText(labels[i]!, -widths[i]! / 2, 0);
      ctx.restore();
      x += widths[i]! + space;
    }
    y += lineHeight;
  }
  ctx.restore();
}
