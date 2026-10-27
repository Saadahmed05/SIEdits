import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import { renderFrame } from '../src/engine/render';
import type { Ctx2D } from '../src/engine/types';
import { RenderError } from '../src/render/errors';
import { createNodeEnv, mapAssetResolver, registerFonts } from '../src/render/node-env';
import { renderVideo, validateForRender } from '../src/render/render-video';
import { exampleProjectJson, smallProject, smallProjectInput, tinyPng } from './fixtures';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'sw-render-'));

function framePixel(file: string, at: number, x: number, y: number): [number, number, number] {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const i = (y * 160 + x) * 3;
  return [raw[i]!, raw[i + 1]!, raw[i + 2]!];
}

async function expectRenderError(p: Promise<unknown>, code: string): Promise<RenderError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(RenderError);
    expect((err as RenderError).code).toBe(code);
    return err as RenderError;
  }
  throw new Error(`expected RenderError ${code}`);
}

describe('renderFrame (engine on Skia)', () => {
  registerFonts();
  const draw = (project = smallProject(), t = 0.25) => {
    const canvas = createCanvas(160, 90);
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    const boxes = renderFrame(ctx, project, t, createNodeEnv(mapAssetResolver(new Map())));
    return { data: ctx.getImageData(0, 0, 160, 90).data, boxes };
  };
  const px = (d: Uint8ClampedArray, x: number, y: number) => [d[(y * 160 + x) * 4]!, d[(y * 160 + x) * 4 + 1]!, d[(y * 160 + x) * 4 + 2]!];

  it('draws backgrounds with resolved brand tokens and returns hit boxes', () => {
    const { data, boxes } = draw();
    expect(px(data, 2, 2)).toEqual([255, 0, 0]); // @primary background
    expect(px(data, 80, 45)).toEqual([0, 255, 0]); // @secondary shape in the centre
    expect(boxes.map((b) => b.elementId)).toEqual(['t1', 'sh1']);
    expect(boxes[1]).toMatchObject({ x: 64, y: 36, width: 32, height: 18 });
  });

  it('cross-fades scenes during a transition', () => {
    const [r, , b] = px(draw(smallProject(), 0.75).data, 2, 2); // halfway red → blue
    expect(r).toBeGreaterThan(60);
    expect(r).toBeLessThan(200);
    expect(b).toBeGreaterThan(60);
    expect(b).toBeLessThan(200);
  });

  it('is deterministic for the same input', () => {
    const p = smallProject();
    expect(Buffer.from(draw(p, 0.6).data).equals(Buffer.from(draw(p, 0.6).data))).toBe(true);
  });

  it('renders text with the bundled fonts (different weights measure differently)', () => {
    const ctx = createCanvas(10, 10).getContext('2d');
    ctx.font = '400 40px "Inter"';
    const regular = ctx.measureText('Nova launch').width;
    ctx.font = '800 40px "Inter"';
    const heavy = ctx.measureText('Nova launch').width;
    expect(heavy).toBeGreaterThan(regular);
  });
});

describe('renderVideo', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0));

  it('encodes a playable H.264 file with the expected dimensions, frames and content', async () => {
    const dir = tmp();
    const out = path.join(dir, 'out.mp4');
    const progress: number[] = [];
    const result = await renderVideo(smallProject(), { assetsDir: dir, output: out, onProgress: (p) => progress.push(p.frame) });
    expect(result.probe).toMatchObject({ codec: 'h264', width: 160, height: 90, frames: 15, pixelFormat: 'yuv420p', fps: 10 });
    expect(result.probe.duration).toBeCloseTo(1.5, 1);
    expect(progress.at(-1)).toBe(15);
    const [r, g, b] = framePixel(out, 0.1, 2, 2);
    expect(r).toBeGreaterThan(200);
    expect(g + b).toBeLessThan(80);
    // No temporary files left behind.
    expect(readdirSync(dir)).toEqual(['out.mp4']);
  });

  it('renders the bundled example project end to end at reduced size', async () => {
    const example = exampleProjectJson() as ReturnType<typeof smallProjectInput>;
    example.settings = { width: 320, height: 180, fps: 10 };
    const dir = tmp();
    const result = await renderVideo(example, { assetsDir: dir, output: path.join(dir, 'nova.mp4') });
    expect(result.probe.frames).toBe(120);
    expect(result.probe.duration).toBeCloseTo(12, 1);
  });

  it('renders uploaded image assets', async () => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'pic.png'), await tinyPng('#ff00ff'));
    const project = smallProject({
      assets: [{ id: 'a1', kind: 'image', name: 'pic', file: 'pic.png', mimeType: 'image/png', width: 4, height: 4 }],
      scenes: [{ id: 's', duration: 0.5, background: { type: 'solid', color: '#000000' }, elements: [{ id: 'i', type: 'image', assetId: 'a1', width: 1 }] }],
    });
    const out = path.join(dir, 'img.mp4');
    await renderVideo(project, { assetsDir: dir, output: out });
    const [r, g, b] = framePixel(out, 0.1, 80, 45);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
  });

  it('rejects invalid projects before starting FFmpeg', async () => {
    const dir = tmp();
    const bad = smallProjectInput();
    bad.scenes[0]!.duration = -2;
    const err = await expectRenderError(renderVideo(bad, { assetsDir: dir, output: path.join(dir, 'x.mp4') }), 'INVALID_PROJECT');
    expect(err.issues.some((i) => i.path === 'scenes[0].duration')).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('rejects odd dimensions that H.264 yuv420p cannot encode', async () => {
    const dir = tmp();
    const err = await expectRenderError(
      renderVideo(smallProject({ settings: { width: 161, height: 90, fps: 10 } }), { assetsDir: dir, output: path.join(dir, 'x.mp4') }),
      'INVALID_PARAMS',
    );
    expect(err.issues[0]!.path).toBe('settings.width');
  });

  it('reports missing asset files used by the project', async () => {
    const dir = tmp();
    const project = smallProject({
      assets: [{ id: 'a1', kind: 'image', name: 'Screenshot', file: 'gone.png', mimeType: 'image/png', width: 4, height: 4 }],
      scenes: [{ id: 's', duration: 1, background: { type: 'solid', color: '#000000' }, elements: [{ id: 'd', type: 'device', assetId: 'a1' }] }],
    });
    const err = await expectRenderError(renderVideo(project, { assetsDir: dir, output: path.join(dir, 'x.mp4') }), 'MISSING_ASSET');
    expect(err.issues[0]!.message).toContain('gone.png');
    // Unreferenced missing assets do not block rendering.
    expect(() => validateForRender({ ...project, scenes: smallProject().scenes }, dir)).not.toThrow();
  });

  it('reports a clear error when FFmpeg is unavailable', async () => {
    const dir = tmp();
    const prev = process.env.FFMPEG_PATH;
    process.env.FFMPEG_PATH = '/nonexistent/ffmpeg';
    try {
      const err = await expectRenderError(renderVideo(smallProject(), { assetsDir: dir, output: path.join(dir, 'x.mp4') }), 'FFMPEG_NOT_FOUND');
      expect(err.message).toMatch(/FFmpeg was not found/);
    } finally {
      if (prev === undefined) delete process.env.FFMPEG_PATH;
      else process.env.FFMPEG_PATH = prev;
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('cancels cleanly and removes partial output', async () => {
    const dir = tmp();
    const controller = new AbortController();
    const long = smallProject({ settings: { width: 320, height: 180, fps: 30 } });
    long.scenes[0]!.duration = 20;
    const p = renderVideo(long, {
      assetsDir: dir,
      output: path.join(dir, 'x.mp4'),
      signal: controller.signal,
      onProgress: (pr) => {
        if (pr.frame > 20) controller.abort();
      },
    });
    await expectRenderError(p, 'CANCELLED');
    expect(readdirSync(dir)).toEqual([]);
  });
});
