import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RenderError } from './errors';

const execFileAsync = promisify(execFile);

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

export function ffprobePath(): string {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

/** First line of `ffmpeg -version`, or null if FFmpeg is not runnable. */
export async function ffmpegVersion(bin = ffmpegPath()): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ['-hide_banner', '-version'], { timeout: 10_000 });
    return stdout.split('\n')[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Throws a RenderError if FFmpeg is missing or lacks the libx264 encoder. */
export async function assertFfmpegReady(bin = ffmpegPath()): Promise<void> {
  const version = await ffmpegVersion(bin);
  if (!version) {
    throw new RenderError(
      'FFMPEG_NOT_FOUND',
      `FFmpeg was not found ("${bin}"). Install FFmpeg (https://ffmpeg.org/download.html) or set FFMPEG_PATH.`,
    );
  }
  try {
    const { stdout } = await execFileAsync(bin, ['-hide_banner', '-encoders'], { timeout: 10_000 });
    if (!/\blibx264\b/.test(stdout)) {
      throw new RenderError('FFMPEG_NOT_FOUND', 'This FFmpeg build has no libx264 encoder; install a build with libx264.');
    }
  } catch (err) {
    if (err instanceof RenderError) throw err;
    throw new RenderError('FFMPEG_NOT_FOUND', `Could not list FFmpeg encoders: ${(err as Error).message}`);
  }
}

export interface ProbeResult {
  codec: string;
  width: number;
  height: number;
  /** Seconds, from the container. */
  duration: number;
  frames: number;
  fps: number;
  pixelFormat: string;
}

/** Inspect a video file with ffprobe (counts frames by decoding, so it proves the file is playable). */
export async function probeVideo(file: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    ffprobePath(),
    [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,nb_read_frames,r_frame_rate,pix_fmt:format=duration',
      '-of', 'json',
      file,
    ],
    { timeout: 120_000 },
  );
  const data = JSON.parse(stdout) as {
    streams?: Array<Record<string, string | number>>;
    format?: { duration?: string };
  };
  const s = data.streams?.[0];
  if (!s) throw new Error('no video stream found');
  const [num, den] = String(s.r_frame_rate ?? '0/1').split('/').map(Number);
  return {
    codec: String(s.codec_name),
    width: Number(s.width),
    height: Number(s.height),
    duration: Number(data.format?.duration ?? 0),
    frames: Number(s.nb_read_frames ?? 0),
    fps: den ? num! / den : 0,
    pixelFormat: String(s.pix_fmt),
  };
}
