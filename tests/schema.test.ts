import { describe, expect, it } from 'vitest';
import { loadProject } from '../src/project/migrate';
import { parseProject, ProjectSchema } from '../src/project/schema';
import { exampleProjectJson, smallProjectInput } from './fixtures';

const issuesOf = (input: unknown) => {
  const r = parseProject(input);
  return r.ok ? [] : r.issues;
};

describe('project schema', () => {
  it('accepts the bundled example project', () => {
    const r = loadProject(exampleProjectJson());
    expect(r.ok).toBe(true);
  });

  it('applies defaults for optional fields', () => {
    const p = ProjectSchema.parse(smallProjectInput());
    const text = p.scenes[0]!.elements![0]!;
    expect(text).toMatchObject({ x: 0.5, y: 0.5, opacity: 1, scale: 1, end: null, font: '@heading', weight: 700 });
    expect(p.render).toEqual({ crf: 18, preset: 'veryfast' });
    expect(p.scenes[0]!.transition).toEqual({ type: 'none', duration: 0 });
  });

  it('rejects unknown keys anywhere (strict objects)', () => {
    const input = smallProjectInput();
    (input.scenes[0]!.elements![0] as Record<string, unknown>).onload = 'alert(1)';
    expect(issuesOf(input).some((i) => i.message.toLowerCase().includes('unrecognized'))).toBe(true);
    expect(issuesOf({ ...smallProjectInput(), script: 'x' }).length).toBeGreaterThan(0);
  });

  it('rejects unsupported element and animation types', () => {
    const a = smallProjectInput();
    (a.scenes[0]!.elements! as unknown[]).push({ id: 'x', type: 'html', html: '<script>' });
    expect(issuesOf(a).length).toBeGreaterThan(0);
    const b = smallProjectInput();
    (b.scenes[0]!.elements![0]!.animations as unknown[]) = [{ type: 'eval', code: '1' }];
    expect(issuesOf(b).length).toBeGreaterThan(0);
  });

  it('rejects invalid colors, fonts and out-of-range numbers', () => {
    const cases: Array<(p: ReturnType<typeof smallProjectInput>) => void> = [
      (p) => ((p.scenes[0]!.background as { color: string }).color = 'red'),
      (p) => ((p.scenes[0]!.background as { color: string }).color = '@nope'),
      (p) => ((p.scenes[0]!.elements![0] as { font?: string }).font = 'Comic Sans'),
      (p) => (p.scenes[0]!.duration = -1),
      (p) => (p.scenes[0]!.duration = 0),
      (p) => (p.settings.fps = 0),
      (p) => (p.settings.fps = 240),
      (p) => (p.settings.width = 100000),
      (p) => ((p.scenes[0]!.elements![0] as { opacity?: number }).opacity = 2),
      (p) => (p.brand.primary = '@primary'),
    ];
    for (const mutate of cases) {
      const input = smallProjectInput();
      mutate(input);
      expect(issuesOf(input).length, mutate.toString()).toBeGreaterThan(0);
    }
  });

  it('rejects a transition longer than either neighbouring scene', () => {
    const input = smallProjectInput();
    input.scenes[1]!.transition = { type: 'fade', duration: 1.5 };
    expect(issuesOf(input).some((i) => i.path === 'scenes[1].transition.duration')).toBe(true);
  });

  it('rejects duplicate ids and unknown asset references', () => {
    const dup = smallProjectInput();
    dup.scenes[1]!.id = 's1';
    expect(issuesOf(dup).some((i) => i.message.includes('duplicate scene id'))).toBe(true);
    const asset = smallProjectInput();
    (asset.scenes[0]!.elements! as unknown[]).push({ id: 'img', type: 'image', assetId: 'nope' });
    expect(issuesOf(asset).some((i) => i.message.includes('unknown asset'))).toBe(true);
  });

  it('rejects text-only animations on non-text elements', () => {
    const input = smallProjectInput();
    input.scenes[0]!.elements![1]!.animations = [{ type: 'typewriter', duration: 1 }];
    expect(issuesOf(input).some((i) => i.message.includes('only applies to text'))).toBe(true);
  });

  it('rejects element timing outside the scene', () => {
    const input = smallProjectInput();
    Object.assign(input.scenes[0]!.elements![0]!, { start: 0.5, end: 0.4 });
    expect(issuesOf(input).some((i) => i.message === 'end must be after start')).toBe(true);
  });

  it('rejects asset file names that could escape the asset directory', () => {
    const input = smallProjectInput({
      assets: [{ id: 'a1', kind: 'image', name: 'x', file: '../../etc/passwd.png', mimeType: 'image/png', width: 1, height: 1 }],
    });
    expect(issuesOf(input).some((i) => i.path.startsWith('assets[0].file'))).toBe(true);
  });

  it('reports versions and formats it cannot load', () => {
    const newer = loadProject({ ...smallProjectInput(), version: 99 });
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.issues[0]!.message).toMatch(/newer than this SceneWright supports/);
    const other = loadProject({ format: 'something-else', version: 1 });
    expect(!other.ok && other.issues[0]!.path).toBe('format');
    expect(loadProject([]).ok).toBe(false);
  });
});
