/**
 * Score hypothesis word timings against a reference: align the two word sequences (edit-distance
 * alignment on normalised text), then measure start-time error on the words that match.
 */
import { normalizeWord, type Word } from './words';

export interface MatchedWord {
  ref: Word;
  hyp: Word;
  /** hyp.start − ref.start, seconds. */
  delta: number;
}

/**
 * Levenshtein alignment over words; returns the pairs whose normalised text is equal.
 * O(n·m) time and memory, fine for a 10-minute transcript (~1,500 × 1,500).
 */
export function alignWords(ref: readonly Word[], hyp: readonly Word[]): MatchedWord[] {
  const a = ref.map((w) => normalizeWord(w.text));
  const b = hyp.map((w) => normalizeWord(w.text));
  const n = a.length;
  const m = b.length;
  const cost = new Uint32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 0; i <= n; i++) cost[at(i, 0)] = i;
  for (let j = 0; j <= m; j++) cost[at(0, j)] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sub = cost[at(i - 1, j - 1)]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      cost[at(i, j)] = Math.min(sub, cost[at(i - 1, j)]! + 1, cost[at(i, j - 1)]! + 1);
    }
  }
  const pairs: MatchedWord[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const same = a[i - 1] === b[j - 1];
    if (cost[at(i, j)] === cost[at(i - 1, j - 1)]! + (same ? 0 : 1)) {
      if (same && a[i - 1]) {
        const r = ref[i - 1]!;
        const h = hyp[j - 1]!;
        pairs.push({ ref: r, hyp: h, delta: h.start - r.start });
      }
      i--;
      j--;
    } else if (cost[at(i, j)] === cost[at(i - 1, j)]! + 1) i--;
    else j--;
  }
  return pairs.reverse();
}

export interface TimingReport {
  referenceWords: number;
  hypothesisWords: number;
  matched: number;
  /** matched / reference words. */
  matchRate: number;
  medianAbsMs: number;
  p90AbsMs: number;
  p95AbsMs: number;
  maxAbsMs: number;
  /** Mean signed error; a large value means a constant offset that could be corrected. */
  biasMs: number;
  /** Share of matched words whose start is within ±tolerance of the reference. */
  withinTolerance: number;
  /** Same, after subtracting the bias. */
  withinToleranceAfterBias: number;
  toleranceMs: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!;
}

export function timingReport(ref: readonly Word[], hyp: readonly Word[], toleranceMs = 100): TimingReport {
  const pairs = alignWords(ref, hyp);
  const deltas = pairs.map((p) => p.delta * 1000);
  const abs = deltas.map(Math.abs).sort((x, y) => x - y);
  const bias = deltas.length ? deltas.reduce((s, d) => s + d, 0) / deltas.length : 0;
  const share = (values: number[]) => (values.length ? values.filter((d) => Math.abs(d) <= toleranceMs).length / values.length : 0);
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    referenceWords: ref.length,
    hypothesisWords: hyp.length,
    matched: pairs.length,
    matchRate: round((pairs.length / Math.max(1, ref.length)) * 1000) / 1000,
    medianAbsMs: round(quantile(abs, 0.5)),
    p90AbsMs: round(quantile(abs, 0.9)),
    p95AbsMs: round(quantile(abs, 0.95)),
    maxAbsMs: round(abs[abs.length - 1] ?? NaN),
    biasMs: round(bias),
    withinTolerance: round(share(deltas) * 1000) / 1000,
    withinToleranceAfterBias: round(share(deltas.map((d) => d - bias)) * 1000) / 1000,
    toleranceMs,
  };
}
