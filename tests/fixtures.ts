import { readFileSync } from 'node:fs';
import type { z } from 'zod';
import { ProjectSchema, type Project } from '../src/project/schema';

export type ProjectInput = z.input<typeof ProjectSchema>;

/** A small, fully deterministic project: 2 scenes, 1 fade transition, every common element. */
export function smallProjectInput(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    format: 'scenewright.project',
    version: 1,
    id: 'test-project',
    name: 'Test project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    settings: { width: 160, height: 90, fps: 10 },
    brand: { primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff', background: '#000000', text: '#ffffff' },
    scenes: [
      {
        id: 's1',
        duration: 1,
        background: { type: 'solid', color: '@primary' },
        elements: [
          { id: 't1', type: 'text', text: 'Hello', animations: [{ type: 'fade-in', duration: 0.5 }] },
          { id: 'sh1', type: 'shape', shape: 'rect', width: 0.2, height: 0.2, fill: '@secondary' },
        ],
      },
      {
        id: 's2',
        duration: 1,
        background: { type: 'solid', color: '#0000ff' },
        transition: { type: 'fade', duration: 0.5 },
        elements: [{ id: 'l1', type: 'logo', wordmark: 'Brand' }],
      },
    ],
    ...overrides,
  };
}

export function smallProject(overrides: Partial<ProjectInput> = {}): Project {
  return ProjectSchema.parse(smallProjectInput(overrides));
}

export function exampleProjectJson(): unknown {
  return JSON.parse(readFileSync(new URL('../examples/nova-launch.project.json', import.meta.url), 'utf8'));
}

/** A valid 4x4 PNG generated with @napi-rs/canvas. */
export async function tinyPng(color = '#ff00ff'): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const c = createCanvas(4, 4);
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 4, 4);
  return c.toBuffer('image/png');
}
