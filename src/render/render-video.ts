/**
 * Render a project to an H.264 MP4: validate → load assets → check FFmpeg → stream raw RGBA
 * frames into ffmpeg → verify the result with ffprobe → atomically move into place.
 * Partial output is always removed on failure or cancellation.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, type Image } from '@napi-rs/canvas';
import { renderFrame } from '../engine/render';
import { frameCount, totalDuration } from '../engine/timeline';
import type { Ctx2D } from '../engine/types';
import { loadProject } from '../project/migrate';
import type { Project, ValidationIssue } from '../project/schema';
import { RenderError } from './errors';
import { assertFfmpegReady, ffmpegPath, probeVideo, type ProbeResult } from './ffmpeg';
import { createNodeEnv, decodeImage, mapAssetResolver, registerFonts } from './node-env';

export interface RenderProgress {
  phase: 'preparing' | 'rendering' | 'verifying';
  frame: number;
  totalFrames: number;
}

export interface RenderOptions {
  /** Directory holding the project's asset files. */
  assetsDir: string;
  /** Destination .mp4 path. */
  output: string;
  onProgress?: (progress: RenderProgress) => void;
  signal?: AbortSignal;
}

export interface RenderResult {
  output: string;
  frames: number;
  duration: number;
  probe: ProbeResult;
  elapsedMs: number;
}

/** Ids of assets referenced by any element. */
export function referencedAssetIds(project: Project): Set<string> {
  const ids = new Set<string>();
  for (const scene of project.scenes)
    for (const el of scene.elements) if ('assetId' in el && el.assetId) ids.add(el.assetId);
  return ids;
}

/** Checks that need the file system or encoder constraints, beyond the schema. */
export function renderParamIssues(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { width, height } = project.settings;
  if (width % 2 !== 0) issues.push({ path: 'settings.width', message: `H.264 (yuv420p) needs an even width, got ${width}` });
  if (height % 2 !== 0) issues.push({ path: 'settings.height', message: `H.264 (yuv420p) needs an even height, got ${height}` });
  return issues;
}

export function missingAssetIssues(project: Project, assetsDir: string): ValidationIssue[] {
  const needed = referencedAssetIds(project);
  const issues: ValidationIssue[] = [];
  project.assets.forEach((asset, i) => {
    if (!needed.has(asset.id)) return;
    const file = path.join(assetsDir, path.basename(asset.file));
    if (!existsSync(file)) issues.push({ path: `assets[${i}]`, message: `file for asset "${asset.name}" not found: ${asset.file}` });
  });
  return issues;
}

/** Validate everything that can be checked before starting expensive work. */
export function validateForRender(input: unknown, assetsDir: string): { project: Project } {
  const parsed = loadProject(input);
  if (!parsed.ok) throw new RenderError('INVALID_PROJECT', 'The project is not valid.', parsed.issues);
  const project = parsed.value;
  const params = renderParamIssues(project);
  if (params.length) throw new RenderError('INVALID_PARAMS', 'Invalid render parameters.', params);
  const missing = missingAssetIssues(project, assetsDir);
  if (missing.length) throw new RenderError('MISSING_ASSET', 'Some assets used by the project are missing.', missing);
  return { project };
}

async function loadAssets(project: Project, assetsDir: string): Promise<Map<string, Image>> {
  const needed = referencedAssetIds(project);
  const images = new Map<string, Image>();
  for (const asset of project.assets) {
    if (!needed.has(asset.id)) continue;
    const file = path.join(assetsDir, path.basename(asset.file));
    try {
      images.set(asset.id, await decodeImage(await readFile(file)));
    } catch (err) {
      throw new RenderError('MISSING_ASSET', `Could not decode asset "${asset.name}": ${(err as Error).message}`, [
        { path: `assets`, message: asset.file },
      ]);
    }
  }
  return images;
}

export async function renderVideo(input: unknown, options: RenderOptions): Promise<RenderResult> {
  const started = Date.now();
  const { project } = validateForRender(input, options.assetsDir);
  const { width, height, fps } = project.settings;
  const totalFrames = frameCount(project);
  const report = (phase: RenderProgress['phase'], frame: number) => options.onProgress?.({ phase, frame, totalFrames });
  const checkCancelled = () => {
    if (options.signal?.aborted) throw new RenderError('CANCELLED', 'Render cancelled.');
  };

  report('preparing', 0);
  await assertFfmpegReady();
  registerFonts();
  const images = await loadAssets(project, options.assetsDir);
  checkCancelled();

  await mkdir(path.dirname(options.output), { recursive: true });
  const partial = `${options.output}.partial-${randomBytes(4).toString('hex')}.mp4`;

  const ffmpeg = spawn(
    ffmpegPath(),
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
      '-c:v', 'libx264', '-preset', project.render.preset, '-crf', String(project.render.crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      partial,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  ffmpeg.stderr.on('data', (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    ffmpeg.once('error', reject);
    ffmpeg.once('close', (code) => resolve(code));
  });
  // Writes after ffmpeg exits raise EPIPE; the exit code is what we report.
  ffmpeg.stdin.on('error', () => {});
  const onAbort = () => ffmpeg.kill('SIGKILL');
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d') as unknown as Ctx2D;
    const env = createNodeEnv(mapAssetResolver(images));
    let processExited = false;
    void exited.finally(() => {
      processExited = true;
    });

    for (let frame = 0; frame < totalFrames; frame++) {
      checkCancelled();
      if (processExited) break;
      renderFrame(ctx, project, frame / fps, env);
      const pixels = ctx.getImageData(0, 0, width, height).data;
      const chunk = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      if (!ffmpeg.stdin.write(chunk)) {
        await Promise.race([new Promise((r) => ffmpeg.stdin.once('drain', r)), exited]);
      }
      if (frame % 5 === 0 || frame === totalFrames - 1) report('rendering', frame + 1);
    }
    ffmpeg.stdin.end();
    const code = await exited;
    checkCancelled();
    if (code !== 0) {
      throw new RenderError('ENCODER_FAILED', `FFmpeg exited with code ${code}: ${stderr.trim() || 'no error output'}`);
    }

    report('verifying', totalFrames);
    let probe: ProbeResult;
    try {
      probe = await probeVideo(partial);
    } catch (err) {
      throw new RenderError('VERIFY_FAILED', `Encoded file could not be read back: ${(err as Error).message}`);
    }
    if (probe.width !== width || probe.height !== height || probe.frames !== totalFrames) {
      throw new RenderError(
        'VERIFY_FAILED',
        `Encoded file does not match the project (got ${probe.width}x${probe.height}, ${probe.frames} frames; expected ${width}x${height}, ${totalFrames} frames)`,
      );
    }
    await rename(partial, options.output);
    return { output: options.output, frames: totalFrames, duration: totalDuration(project.scenes), probe, elapsedMs: Date.now() - started };
  } catch (err) {
    ffmpeg.kill('SIGKILL');
    await exited.catch(() => null);
    await rm(partial, { force: true });
    if (err instanceof RenderError) throw err;
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RenderError('FFMPEG_NOT_FOUND', `FFmpeg could not be started: ${(err as Error).message}`);
    }
    throw new RenderError('ENCODER_FAILED', (err as Error).message);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}
