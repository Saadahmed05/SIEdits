/** The design rules as tests, so the interface and default looks cannot drift back. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MOOD_STYLES } from '../src/storyboard/moods';
import { TEMPLATES } from '../src/storyboard/templates';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const css = read('src/editor/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** Hue in degrees, or null for greys and near-greys. */
function hue(hex: string): number | null {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 0.08) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const isPurple = (hex: string) => {
  const h = hue(hex);
  return h !== null && h >= 245 && h <= 320;
};

describe('editor stylesheet', () => {
  it('has no gradients, blur or text glow', () => {
    expect(css).not.toMatch(/gradient\(|backdrop-filter|blur\(|text-shadow/);
  });

  it('keeps corners at 2 px or less', () => {
    const radii = [...css.matchAll(/(?:border-radius|--radius):\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(radii.length).toBeGreaterThan(0);
    for (const r of radii) if (r !== 'var(--radius)') expect(Number.parseFloat(r)).toBeLessThanOrEqual(2);
  });

  it('only uses shadows on the floating menu', () => {
    expect(css.match(/box-shadow/g)).toHaveLength(1);
    expect(css).toMatch(/\.menu \{[^}]*box-shadow/);
  });

  it('contains no purple', () => {
    for (const [hex] of css.matchAll(/#[0-9a-fA-F]{6}\b/g)) expect(isPurple(hex), hex).toBe(false);
  });

  it('uses two type sizes', () => {
    const sizes = new Set([...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1])));
    for (const size of sizes) expect([10, 11, 12]).toContain(size);
  });
});

describe('editor markup', () => {
  it('uses the icon set rather than text glyphs for controls', () => {
    const dir = new URL('../src/editor/components/', import.meta.url);
    for (const file of readdirSync(dir)) {
      expect(readFileSync(path.join(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'), file), 'utf8'), file).not.toMatch(/[↶↷⏮▶❚↑↓⧉✕✓]/);
    }
  });
});

describe('default video looks', () => {
  it.each(Object.entries(MOOD_STYLES))('%s is flat, with no purple', (_id, mood) => {
    expect(mood.background.type).toBe('solid');
    expect(mood.emphasisBackground.type).toBe('solid');
    expect(mood.glow).toBe(false);
    expect(mood.particles).toBe(false);
    for (const key of ['primary', 'secondary', 'accent', 'background', 'text'] as const) expect(isPurple(mood.brand[key]), key).toBe(false);
  });

  it('template briefs do not ask for glow', () => {
    for (const t of TEMPLATES) expect(t.defaultBrief, t.id).not.toMatch(/glow/i);
  });
});
