import { describe, expect, it } from 'vitest';
import { packBundle, sniffImageType, unpackBundle } from '../src/project/bundle';
import { addAsset, createElement, deleteScene, duplicateScene, moveScene, removeAsset, updateBrand, updateElement } from '../src/project/edit';
import { loadProject } from '../src/project/migrate';
import { parseProject, type Asset } from '../src/project/schema';
import { exampleProjectJson, smallProject, tinyPng } from './fixtures';

const asset: Asset = { id: 'a1', kind: 'image', name: 'logo', file: 'a1.png', mimeType: 'image/png', width: 4, height: 4 };

describe('project serialization', () => {
  it('round-trips through JSON without loss', () => {
    const project = smallProject();
    const back = loadProject(JSON.parse(JSON.stringify(project)));
    expect(back.ok && back.value).toEqual(project);
  });

  it('round-trips the example and is stable after defaults are applied', () => {
    const first = loadProject(exampleProjectJson());
    expect(first.ok).toBe(true);
    const second = loadProject(JSON.parse(JSON.stringify(first.ok && first.value)));
    expect(second.ok && second.value).toEqual(first.ok && first.value);
  });
});

describe('bundles (project + embedded assets)', () => {
  it('pack → unpack returns the same project and bytes', async () => {
    const png = new Uint8Array(await tinyPng());
    const project = addAsset(smallProject(), asset);
    const bundle = JSON.parse(JSON.stringify(packBundle(project, [{ file: 'a1.png', data: png }])));
    const r = unpackBundle(bundle);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project).toEqual(project);
    expect(Buffer.from(r.files[0]!.data).equals(Buffer.from(png))).toBe(true);
  });

  it('rejects assets whose bytes do not match the declared type', () => {
    const project = addAsset(smallProject(), asset);
    const bundle = JSON.parse(JSON.stringify(packBundle(project, [{ file: 'a1.png', data: new TextEncoder().encode('<svg onload=alert(1)>') }])));
    const r = unpackBundle(bundle);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0]!.message).toMatch(/not a image\/png/);
  });

  it('rejects invalid projects and stray files inside bundles', () => {
    const bad = { format: 'scenewright.bundle', version: 1, project: { format: 'scenewright.project', version: 1 }, assets: {} };
    expect(unpackBundle(bad).ok).toBe(false);
    const stray = { ...(packBundle(smallProject(), []) as object), assets: { 'x.png': { mimeType: 'image/png', data: '' } } };
    expect(unpackBundle(JSON.parse(JSON.stringify(stray))).ok).toBe(false);
  });

  it('sniffs image types from magic bytes', async () => {
    expect(sniffImageType(new Uint8Array(await tinyPng()))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageType(new TextEncoder().encode('GIF89a'))).toBeNull();
  });
});

describe('edit operations', () => {
  it('produce valid projects and never mutate their input', () => {
    const original = smallProject();
    const frozen = JSON.stringify(original);
    let p = updateElement(original, 's1', 't1', { text: 'Changed' } as never);
    p = updateBrand(p, { primary: '#123456' });
    p = duplicateScene(p, 's1').project;
    p = moveScene(p, 's2', -1);
    p = deleteScene(p, 's1');
    expect(JSON.stringify(original)).toBe(frozen);
    expect(parseProject(p).ok).toBe(true);
    expect(p.scenes.map((s) => s.id)[0]).toBe('s2');
    expect(deleteScene(smallProject({ scenes: [smallProject().scenes[0]!] }), 's1').scenes).toHaveLength(1);
  });

  it('createElement yields schema-valid elements of each kind', () => {
    for (const type of ['text', 'shape', 'logo', 'device', 'particles'] as const) {
      const p = smallProject();
      p.scenes[0]!.elements.push(createElement(type));
      expect(parseProject(p).ok, type).toBe(true);
    }
  });

  it('removing an asset clears references so the project stays valid', () => {
    let p = addAsset(smallProject(), asset);
    p.scenes[0]!.elements.push(createElement('image', { assetId: 'a1' }), createElement('logo', { assetId: 'a1' }));
    expect(parseProject(p).ok).toBe(true);
    p = removeAsset(p, 'a1');
    expect(parseProject(p).ok).toBe(true);
    expect(p.scenes[0]!.elements.find((e) => e.type === 'logo')).toMatchObject({ assetId: null });
    expect(p.scenes[0]!.elements.some((e) => e.type === 'image')).toBe(false);
  });
});
