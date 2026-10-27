/**
 * Server-side preview frames for agents: footage frame (via FFmpeg) cropped to the output
 * aspect, then zoom, captions and callouts drawn with the same code as the browser export.
 */
import { spawn } from 'node:child_process';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Ctx2D } from '../../src/engine/types';
import { ffmpegPath } from '../../src/render/ffmpeg';
import { createNodeEnv, mapAssetResolver, registerFonts } from '../../src/render/node-env';
import { BOLD_POP, drawCaptions, paginate, type CaptionStyle } from '../shared/captions';
import { calloutTrack, drawOverlays } from '../shared/overlay';
import type { Reel } from './reel';

const CLEAN: CaptionStyle = { ...BOLD_POP, weight: 600, size: 0.04, highlight: '#ffffff', strokeWidth: 0.1, uppercase: false, maxWordsPerPage: 7 };

/** One frame of the source at time t, centre-cropped and scaled to W×H, as PNG bytes. */
function grabFrame(file: string, t: number, W: number, H: number): Promise<Buffer> {
  const filter = `crop='min(iw,ih*${W}/${H})':'min(ih,iw*${H}/${W})',scale=${W}:${H}`;
  const args = ['-hide_banner', '-loglevel', 'error', '-ss', t.toFixed(3), '-i', file, '-frames:v', '1', '-vf', filter, '-f', 'image2pipe', '-vcodec', 'png', '-'];
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args);
    const chunks: Buffer[] = [];
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 && chunks.length ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg frame grab failed: ${stderr.trim() || `exit ${code}`}`))));
  });
}

/** Render the reel at source time t (seconds). Returns PNG bytes at `scale` × output size. */
export async function renderPreview(reel: Reel, t: number, scale = 0.5): Promise<Buffer> {
  registerFonts();
  const W = reel.output.width;
  const H = reel.output.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as Ctx2D;

  const zoom = reel.zooms.find((z) => t >= z.start && t < z.end);
  ctx.save();
  if (zoom) {
    ctx.translate(W / 2, H / 2);
    ctx.scale(zoom.scale, zoom.scale);
    ctx.translate(-W / 2, -H / 2);
  }
  if (reel.source.file) {
    const frame = await loadImage(await grabFrame(reel.source.file, t, W, H));
    ctx.drawImage(frame as unknown as CanvasImageSource, 0, 0, W, H);
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#334155');
    g.addColorStop(1, '#0f172a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.restore();

  if (reel.captions.style !== 'off') {
    const style = reel.captions.style === 'clean' ? CLEAN : BOLD_POP;
    drawCaptions(ctx, paginate(reel.words, style.maxWordsPerPage), t, W, H, style);
  }
  drawOverlays(ctx, calloutTrack(reel.callouts, W, H, reel.output.fps), t, createNodeEnv(mapAssetResolver(new Map())));

  const out = createCanvas(Math.round(W * scale), Math.round(H * scale));
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  return out.toBuffer('image/png');
}
