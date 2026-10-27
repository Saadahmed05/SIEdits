import { describe, expect, it } from 'vitest';
import { alignWords, timingReport } from '../spikes/shared/align';
import { pageAt, paginate } from '../spikes/shared/captions';
import { calloutTrack } from '../spikes/shared/overlay';
import { normalizeWord, parseWords, syntheticWords, type Word } from '../spikes/shared/words';
import { applyOps, createReel, keptDuration, lintReel, silenceCuts } from '../spikes/mcp-server/reel';

const w = (text: string, start: number, end: number): Word => ({ text, start, end });
const WORDS = [w('So', 0.1, 0.35), w('today', 0.35, 0.7), w('I', 0.7, 0.84), w('want', 0.84, 1.1), w('to', 1.1, 1.2), w('code.', 2.5, 2.9), w('Pick', 2.9, 3.2), w('one', 3.2, 3.5)];

function reel(words = WORDS) {
  return createReel({ id: 'r', name: 'Reel', source: { file: null, duration: 10, width: 1920, height: 1080 }, words });
}

describe('words', () => {
  it('parses plain lists, {words} and transformers.js chunks', () => {
    expect(parseWords([{ text: 'b', start: 2, end: 3 }, { text: 'a', start: 1, end: 2 }]).map((x) => x.text)).toEqual(['a', 'b']);
    expect(parseWords({ words: [{ text: 'x', start: 0, end: 1 }] })).toHaveLength(1);
    expect(parseWords({ chunks: [{ text: ' Hello', timestamp: [0.5, null] }] })).toEqual([{ text: 'Hello', start: 0.5, end: 0.5 }]);
    expect(parseWords([{ text: '', start: 0, end: 1 }, { text: 'ok', start: 'nope', end: 1 }])).toEqual([]);
  });

  it('normalises punctuation and case', () => {
    expect(normalizeWord(' Country.')).toBe('country');
    expect(normalizeWord("don't")).toBe('dont');
  });

  it('makes deterministic synthetic transcripts', () => {
    expect(syntheticWords(5)).toEqual(syntheticWords(5));
    expect(syntheticWords(5).at(-1)!.start).toBeLessThan(5);
  });
});

describe('captions', () => {
  it('pages at most N words and breaks at pauses', () => {
    const pages = paginate(WORDS, 4);
    expect(pages.map((p) => p.words.map((x) => x.text).join(' '))).toEqual(['So today I want', 'to', 'code. Pick one']);
  });

  it('holds a page briefly after its last word, never over the next page', () => {
    const pages = paginate(WORDS, 4);
    expect(pageAt(pages, 0.05)).toBeUndefined();
    expect(pageAt(pages, 0.9)?.words[0]!.text).toBe('So');
    expect(pageAt(pages, 1.5)?.words[0]!.text).toBe('to');
    expect(pageAt(pages, 2)).toBeUndefined();
  });
});

describe('timing alignment', () => {
  it('matches words despite insertions, deletions and punctuation', () => {
    const ref = [w('the', 0, 0.2), w('three', 0.2, 0.5), w('biggest', 0.5, 0.9), w('mistakes', 0.9, 1.4)];
    const hyp = [w(' The', 0.03, 0.2), w('3', 0.2, 0.5), w('biggest,', 0.56, 0.9), w('uh', 0.9, 1), w('mistakes.', 1.1, 1.4)];
    const pairs = alignWords(ref, hyp);
    expect(pairs.map((p) => p.ref.text)).toEqual(['the', 'biggest', 'mistakes']);
    const report = timingReport(ref, hyp);
    expect(report.matched).toBe(3);
    expect(report.matchRate).toBe(0.75);
    expect(report.withinTolerance).toBeCloseTo(2 / 3, 3);
    expect(report.maxAbsMs).toBe(200);
  });
});

describe('reel ops', () => {
  it('applies a valid batch and bumps the revision', () => {
    const res = applyOps(reel(), [
      { op: 'cut', start: 1.2, end: 2.5, reason: 'pause' },
      { op: 'add_callout', template: 'hook-title', text: 'Learn to code', start: 0.1, end: 2.4 },
      { op: 'set_caption_style', style: 'clean' },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.reel.revision).toBe(1);
    expect(res.reel.cuts).toHaveLength(1);
    expect(keptDuration(res.reel)).toBeCloseTo(8.7, 6);
    expect(res.applied.map((a) => a.id)).toEqual(['cut-1', 'callout-2', undefined]);
  });

  it('rejects the whole batch and explains each failing op', () => {
    const original = reel();
    const res = applyOps(original, [
      { op: 'cut', start: 0.5, end: 2.5 },
      { op: 'add_callout', template: 'stat-card', text: 'x'.repeat(40), start: 3, end: 5 },
      { op: 'zoom', start: 4, end: 3 },
      { op: 'explode' },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.map((e) => e.index)).toEqual([0, 1, 2, 3]);
    expect(res.errors[0]!.message).toContain('splits the word "today"');
    expect(res.errors[1]!.message).toContain('fits at most 32');
    expect(res.errors[2]!.message).toContain('must be after start');
    expect(original.revision).toBe(0);
    expect(original.cuts).toHaveLength(0);
  });

  it('allows cut edges in silence and on boundaries, refuses overlaps', () => {
    const first = applyOps(reel(), [{ op: 'cut', start: 1.6, end: 2.5 }]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const overlap = applyOps(first.reel, [{ op: 'cut', start: 1.2, end: 2 }]);
    expect(!overlap.ok && overlap.errors[0]!.message).toContain('overlaps');
  });

  it('lints hidden and overlapping callouts and a missing hook', () => {
    const res = applyOps(reel(), [
      { op: 'cut', start: 1.2, end: 2.5 },
      { op: 'add_callout', template: 'list-item', text: 'Point', start: 1.5, end: 4 },
      { op: 'add_callout', template: 'stat-card', text: '87%', start: 3, end: 5 },
      { op: 'set_caption_style', style: 'off' },
    ]);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const codes = lintReel(res.reel).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['callout-in-cut', 'callout-overlap', 'no-hook', 'no-captions']));
  });

  it('finds silence cuts that the op validator accepts', () => {
    const cuts = silenceCuts(WORDS);
    expect(cuts).toHaveLength(1);
    expect(applyOps(reel(), cuts.map((c) => ({ op: 'cut', ...c }))).ok).toBe(true);
  });
});

describe('callout templates', () => {
  it('compile to valid SceneWright scenes for every template', () => {
    const track = calloutTrack(
      [
        { id: 'a-1', template: 'hook-title', text: 'Hook', start: 0, end: 2 },
        { id: 'b-2', template: 'lower-third', text: 'Name | Role', start: 2, end: 5 },
        { id: 'c-3', template: 'stat-card', text: '87%', start: 5, end: 7 },
        { id: 'd-4', template: 'list-item', text: 'Point one', start: 7, end: 9 },
      ],
      1080,
      1920,
      30,
    );
    expect(track.project.scenes.map((s) => s.elements.length)).toEqual([2, 3, 2, 3]);
  });
});
