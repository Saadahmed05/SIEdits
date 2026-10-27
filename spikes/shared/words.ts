/**
 * Word timings shared by the spikes: the caption renderer (spike A) draws them, the Whisper
 * spike (B) produces and scores them. Times are seconds on the source media's clock.
 */

export interface Word {
  text: string;
  start: number;
  end: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toWord(v: unknown): Word | null {
  if (!isRecord(v)) return null;
  const text = typeof v.text === 'string' ? v.text.trim() : '';
  // transformers.js chunks: { text, timestamp: [start, end] }
  const ts = Array.isArray(v.timestamp) ? v.timestamp : null;
  const start = Number(ts ? ts[0] : v.start);
  const rawEnd = ts ? ts[1] : v.end;
  const end = rawEnd === null || rawEnd === undefined ? start : Number(rawEnd);
  if (!text || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { text, start, end: Math.max(start, end) };
}

/**
 * Accepts `[{ text, start, end }]`, `{ words: [...] }` or a transformers.js ASR result
 * (`{ chunks: [{ text, timestamp: [s, e] }] }`). Invalid entries are dropped.
 */
export function parseWords(json: unknown): Word[] {
  const list = Array.isArray(json)
    ? json
    : isRecord(json) && Array.isArray(json.words)
      ? json.words
      : isRecord(json) && Array.isArray(json.chunks)
        ? json.chunks
        : [];
  return list
    .map(toWord)
    .filter((w): w is Word => w !== null)
    .sort((a, b) => a.start - b.start);
}

const FILLER = (
  'so today I want to show you the three biggest mistakes people make when they start ' +
  'learning to code and how you can avoid every single one of them in less than a week'
).split(' ');

/** Deterministic stand-in transcript (~3 words/s) for footage that has no transcript yet. */
export function syntheticWords(duration: number, from = 0): Word[] {
  const words: Word[] = [];
  let t = from;
  for (let i = 0; t < from + duration; i++) {
    const text = FILLER[i % FILLER.length]!;
    const length = 0.18 + text.length * 0.035;
    words.push({ text, start: t, end: t + length });
    // A longer pause every 12 words, like a sentence break.
    t += length + (i % 12 === 11 ? 0.55 : 0.08);
  }
  return words;
}

/** Lowercase, strip punctuation: the form used to match hypothesis and reference words. */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}
