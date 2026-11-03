import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { boxContains, pickElement } from '../src/engine/hit-test';
import { renderFrame } from '../src/engine/render';
import type { Ctx2D, ElementBox } from '../src/engine/types';
import { createNodeEnv, mapAssetResolver } from '../src/render/node-env';
import { smallProject } from './fixtures';

const box = (over: Partial<ElementBox> = {}): ElementBox => ({
  sceneId: 's',
  elementId: 'e',
  x: 40,
  y: 45,
  width: 80,
  height: 10,
  anchorX: 80,
  anchorY: 50,
  rotation: 0,
  ...over,
});

describe('boxContains', () => {
  it('matches the plain box when the element is not rotated', () => {
    expect(boxContains(box(), 110, 50)).toBe(true);
    expect(boxContains(box(), 80, 80)).toBe(false);
  });

  it('follows the element when it is rotated around its anchor', () => {
    const upright = box({ rotation: 90 });
    expect(boxContains(upright, 80, 80)).toBe(true);
    expect(boxContains(upright, 110, 50)).toBe(false);
  });

  it('handles rotation around an anchor at the edge of the box', () => {
    const swung = box({ x: 80, anchorX: 80, rotation: 180 });
    expect(boxContains(swung, 60, 50)).toBe(true);
    expect(boxContains(swung, 100, 50)).toBe(false);
  });
});

describe('pickElement', () => {
  it('prefers the smallest element under the point', () => {
    const full = box({ elementId: 'full', x: 0, y: 0, width: 160, height: 90 });
    const bar = box({ elementId: 'bar' });
    expect(pickElement([full, bar], 80, 50)?.elementId).toBe('bar');
    expect(pickElement([full, bar], 10, 10)?.elementId).toBe('full');
    expect(pickElement([bar], 10, 10)).toBeUndefined();
  });
});

describe('renderFrame hit boxes', () => {
  it('report the anchor and rotation the element was drawn with', () => {
    const project = smallProject({
      scenes: [
        {
          id: 's1',
          duration: 1,
          background: { type: 'solid', color: '#000000' },
          elements: [{ id: 'bar', type: 'shape', shape: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.1, rotation: 90 }],
        },
      ],
    });
    const ctx = createCanvas(160, 90).getContext('2d') as unknown as Ctx2D;
    const [bar] = renderFrame(ctx, project, 0.5, createNodeEnv(mapAssetResolver(new Map())));
    expect(bar).toMatchObject({ anchorX: 80, anchorY: 45, rotation: 90 });
    expect(boxContains(bar!, 80, 10)).toBe(true);
    expect(boxContains(bar!, 40, 45)).toBe(false);
  });
});
