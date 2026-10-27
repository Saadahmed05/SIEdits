/**
 * The reel document an agent edits through MCP: a sketch of format v2 for one talking-head
 * clip. Source words come from transcription; cuts, callouts and zooms are what the agent
 * (or the rule-based first cut) adds. Every change goes through `applyOps`, which validates
 * each operation against the schema *and* the transcript, and applies all of them or none.
 */
import { z } from 'zod';
import type { Word } from '../shared/words';

export const CALLOUT_TEMPLATES = {
  'hook-title': { maxChars: 28, minSeconds: 1.2, maxSeconds: 4, description: 'Big title pill at the top. For the hook in the first 3 s.' },
  'lower-third': { maxChars: 40, minSeconds: 2, maxSeconds: 8, description: 'Name + role bar near the bottom. Use once, early.' },
  'stat-card': { maxChars: 32, minSeconds: 1.5, maxSeconds: 6, description: 'Big number with a short label, e.g. "87% | of beginners quit".' },
  'list-item': { maxChars: 36, minSeconds: 1.5, maxSeconds: 8, description: 'Numbered point ("Mistake #1: …") for list-style videos.' },
} as const;
export type CalloutTemplate = keyof typeof CALLOUT_TEMPLATES;
const TEMPLATE_IDS = Object.keys(CALLOUT_TEMPLATES) as [CalloutTemplate, ...CalloutTemplate[]];

export const CAPTION_STYLES = ['bold-pop', 'clean', 'off'] as const;

const seconds = z.number().min(0).max(4 * 3600);
const id = z.string().regex(/^[a-z]+-\d+$/);

export const CutSchema = z.strictObject({ id, start: seconds, end: seconds, reason: z.string().max(80).default('') });
export const CalloutSchema = z.strictObject({ id, template: z.enum(TEMPLATE_IDS), text: z.string().min(1).max(80), start: seconds, end: seconds });
export const ZoomSchema = z.strictObject({ id, start: seconds, end: seconds, scale: z.number().min(1).max(2) });

export interface Reel {
  id: string;
  name: string;
  revision: number;
  source: { file: string | null; duration: number; width: number; height: number };
  output: { width: number; height: number; fps: number };
  words: Word[];
  cuts: z.infer<typeof CutSchema>[];
  callouts: z.infer<typeof CalloutSchema>[];
  zooms: z.infer<typeof ZoomSchema>[];
  captions: { style: (typeof CAPTION_STYLES)[number] };
  nextId: number;
}

/** Typed edit operations: the only way an agent can change a reel. */
export const OpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('cut'), start: seconds, end: seconds, reason: z.string().max(80).optional() }),
  z.strictObject({ op: z.literal('restore'), id }),
  z.strictObject({ op: z.literal('add_callout'), template: z.enum(TEMPLATE_IDS), text: z.string().min(1).max(80), start: seconds, end: seconds }),
  z.strictObject({
    op: z.literal('update_callout'),
    id,
    text: z.string().min(1).max(80).optional(),
    start: seconds.optional(),
    end: seconds.optional(),
  }),
  z.strictObject({ op: z.literal('remove_callout'), id }),
  z.strictObject({ op: z.literal('zoom'), start: seconds, end: seconds, scale: z.number().min(1).max(2).default(1.15) }),
  z.strictObject({ op: z.literal('remove_zoom'), id }),
  z.strictObject({ op: z.literal('set_caption_style'), style: z.enum(CAPTION_STYLES) }),
]);
export type Op = z.infer<typeof OpSchema>;

export interface OpError {
  /** Index into the ops array. */
  index: number;
  message: string;
}

export type ApplyResult =
  | { ok: true; reel: Reel; applied: { index: number; op: Op['op']; id?: string }[] }
  | { ok: false; errors: OpError[] };

/** How far a cut edge may reach into a word before it counts as splitting it, seconds. */
export const WORD_EDGE_SLACK = 0.04;

function checkRange(reel: Reel, start: number, end: number, label: string): string | null {
  if (end <= start) return `${label}: end (${end}) must be after start (${start})`;
  if (end > reel.source.duration + 1e-6) return `${label}: end ${end} is past the end of the footage (${reel.source.duration} s)`;
  return null;
}

/** Cut edges may sit in silence or on a word boundary, never inside a word. */
function checkCutEdge(reel: Reel, t: number, label: string): string | null {
  const w = reel.words.find((x) => t > x.start + WORD_EDGE_SLACK && t < x.end - WORD_EDGE_SLACK);
  if (!w) return null;
  return `${label} ${t} splits the word "${w.text}" (${w.start}–${w.end}); move it to a word boundary (call get_transcript for exact times)`;
}

function checkCallout(reel: Reel, template: CalloutTemplate, text: string, start: number, end: number): string | null {
  const t = CALLOUT_TEMPLATES[template];
  if (text.length > t.maxChars) return `text is ${text.length} characters; template "${template}" fits at most ${t.maxChars}`;
  const length = end - start;
  if (length < t.minSeconds || length > t.maxSeconds) {
    return `"${template}" must stay on screen ${t.minSeconds}–${t.maxSeconds} s (got ${length.toFixed(2)} s)`;
  }
  return checkRange(reel, start, end, 'callout');
}

/**
 * Validate and apply a batch of operations. Ops see the effects of earlier ops in the same
 * batch. Any failure rejects the whole batch with a reason per failing op.
 */
export function applyOps(reel: Reel, rawOps: unknown[]): ApplyResult {
  const next: Reel = structuredClone(reel);
  const errors: OpError[] = [];
  const applied: { index: number; op: Op['op']; id?: string }[] = [];
  const newId = (prefix: string) => `${prefix}-${next.nextId++}`;

  rawOps.forEach((raw, index) => {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ index, message: parsed.error.issues.map((i) => `${i.path.join('.') || 'op'}: ${i.message}`).join('; ') });
      return;
    }
    const op = parsed.data;
    const fail = (message: string | null) => (message ? (errors.push({ index, message }), true) : false);
    switch (op.op) {
      case 'cut': {
        if (fail(checkRange(next, op.start, op.end, 'cut') ?? checkCutEdge(next, op.start, 'cut start') ?? checkCutEdge(next, op.end, 'cut end'))) return;
        if (next.cuts.some((c) => op.start < c.end && op.end > c.start)) return void fail('cut overlaps an existing cut; restore it first');
        const cutId = newId('cut');
        next.cuts.push({ id: cutId, start: op.start, end: op.end, reason: op.reason ?? '' });
        next.cuts.sort((a, b) => a.start - b.start);
        applied.push({ index, op: op.op, id: cutId });
        return;
      }
      case 'restore': {
        const before = next.cuts.length;
        next.cuts = next.cuts.filter((c) => c.id !== op.id);
        if (next.cuts.length === before) return void fail(`no cut with id "${op.id}"`);
        applied.push({ index, op: op.op, id: op.id });
        return;
      }
      case 'add_callout': {
        if (fail(checkCallout(next, op.template, op.text, op.start, op.end))) return;
        const calloutId = newId('callout');
        next.callouts.push({ id: calloutId, template: op.template, text: op.text, start: op.start, end: op.end });
        next.callouts.sort((a, b) => a.start - b.start);
        applied.push({ index, op: op.op, id: calloutId });
        return;
      }
      case 'update_callout': {
        const c = next.callouts.find((x) => x.id === op.id);
        if (!c) return void fail(`no callout with id "${op.id}"`);
        const updated = { ...c, text: op.text ?? c.text, start: op.start ?? c.start, end: op.end ?? c.end };
        if (fail(checkCallout(next, updated.template, updated.text, updated.start, updated.end))) return;
        Object.assign(c, updated);
        applied.push({ index, op: op.op, id: op.id });
        return;
      }
      case 'remove_callout': {
        const before = next.callouts.length;
        next.callouts = next.callouts.filter((c) => c.id !== op.id);
        if (next.callouts.length === before) return void fail(`no callout with id "${op.id}"`);
        applied.push({ index, op: op.op, id: op.id });
        return;
      }
      case 'zoom': {
        if (fail(checkRange(next, op.start, op.end, 'zoom'))) return;
        if (op.end - op.start > 10) return void fail('zooms longer than 10 s look static; split it or use a shorter range');
        const zoomId = newId('zoom');
        next.zooms.push({ id: zoomId, start: op.start, end: op.end, scale: op.scale });
        next.zooms.sort((a, b) => a.start - b.start);
        applied.push({ index, op: op.op, id: zoomId });
        return;
      }
      case 'remove_zoom': {
        const before = next.zooms.length;
        next.zooms = next.zooms.filter((z) => z.id !== op.id);
        if (next.zooms.length === before) return void fail(`no zoom with id "${op.id}"`);
        applied.push({ index, op: op.op, id: op.id });
        return;
      }
      case 'set_caption_style':
        next.captions.style = op.style;
        applied.push({ index, op: op.op });
        return;
    }
  });

  if (errors.length) return { ok: false, errors };
  next.revision++;
  return { ok: true, reel: next, applied };
}

/** Seconds of footage left after cuts. */
export function keptDuration(reel: Reel): number {
  return reel.source.duration - reel.cuts.reduce((s, c) => s + (c.end - c.start), 0);
}

export interface LintIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  at?: number;
}

/** Deterministic quality checks the agent must clear before export. */
export function lintReel(reel: Reel): LintIssue[] {
  const issues: LintIssue[] = [];
  const inCut = (t: number) => reel.cuts.some((c) => t >= c.start && t < c.end);

  for (const c of reel.callouts) {
    if (inCut(c.start)) issues.push({ severity: 'error', code: 'callout-in-cut', message: `${c.id} starts inside a cut, so it would never be seen`, at: c.start });
  }
  const sorted = [...reel.callouts].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start < prev.end) issues.push({ severity: 'error', code: 'callout-overlap', message: `${cur.id} overlaps ${prev.id}`, at: cur.start });
  }
  if (!sorted.some((c) => c.template === 'hook-title' && c.start < 3)) {
    issues.push({ severity: 'warning', code: 'no-hook', message: 'no hook-title in the first 3 s; most reels lose viewers there' });
  }
  if (reel.captions.style === 'off') issues.push({ severity: 'warning', code: 'no-captions', message: 'captions are off; most viewers watch muted' });

  // Long stretches with no visual change (callout or zoom start) feel static.
  const events = [0, ...reel.callouts.map((c) => c.start), ...reel.zooms.map((z) => z.start), reel.source.duration]
    .filter((t) => !inCut(t))
    .sort((a, b) => a - b);
  for (let i = 1; i < events.length; i++) {
    const gap = events[i]! - events[i - 1]!;
    if (gap > 12) {
      issues.push({ severity: 'warning', code: 'static-stretch', message: `${gap.toFixed(0)} s without a zoom or graphic`, at: events[i - 1] });
    }
  }
  const perMinute = reel.callouts.length / Math.max(1 / 60, keptDuration(reel) / 60);
  if (perMinute > 6) issues.push({ severity: 'warning', code: 'callout-density', message: `${perMinute.toFixed(1)} callouts per minute; keep it under 6` });
  return issues;
}

/** Rule-based first cut (no AI): remove pauses longer than `minGap` seconds between words. */
export function silenceCuts(words: readonly Word[], minGap = 0.6, pad = 0.1): { start: number; end: number }[] {
  const cuts: { start: number; end: number }[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i]!.start - words[i - 1]!.end;
    if (gap > minGap) cuts.push({ start: words[i - 1]!.end + pad, end: words[i]!.start - pad });
  }
  return cuts;
}

export function createReel(init: Pick<Reel, 'id' | 'name' | 'source' | 'words'> & Partial<Pick<Reel, 'output'>>): Reel {
  return {
    ...init,
    revision: 0,
    output: init.output ?? { width: 1080, height: 1920, fps: 30 },
    cuts: [],
    callouts: [],
    zooms: [],
    captions: { style: 'bold-pop' },
    nextId: 1,
  };
}
