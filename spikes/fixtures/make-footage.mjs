// Builds the spike A input: 10 minutes of 1080p30 H.264 + AAC, like phone footage of a talking
// head, using FFmpeg's test pattern for video and the spike B speech for audio.
//   node spikes/fixtures/make-footage.mjs [minutes]
// Run make-speech.ps1 first for real speech; without it the audio is a sine tone.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';

const minutes = Number(process.argv[2] ?? 10);
const seconds = Math.round(minutes * 60);
const dir = path.resolve(import.meta.dirname, '../../.tmp/fixtures');
mkdirSync(dir, { recursive: true });
const speech = path.join(dir, 'speech.wav');
const out = path.join(dir, `talking-${minutes}min-1080p.mp4`);
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';

const audioInput = existsSync(speech)
  ? ['-i', speech]
  : ['-f', 'lavfi', '-i', `sine=frequency=220:sample_rate=48000:duration=${seconds}`];

const args = [
  '-y',
  '-hide_banner',
  '-loglevel', 'error',
  '-f', 'lavfi',
  '-i', `testsrc2=size=1920x1080:rate=30:duration=${seconds}`,
  ...audioInput,
  // Pad or cut the audio to the video length; stereo 48 kHz like phone recordings.
  '-filter_complex', `[1:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,atrim=0:${seconds}[a]`,
  '-map', '0:v',
  '-map', '[a]',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '23',
  '-g', '60',
  '-pix_fmt', 'yuv420p',
  '-c:a', 'aac',
  '-b:a', '128k',
  '-movflags', '+faststart',
  out,
];

console.log(`Encoding ${out} (${seconds} s)…`);
const res = spawnSync(ffmpeg, args, { stdio: 'inherit' });
if (res.status !== 0) {
  console.error(`ffmpeg failed (${res.error?.message ?? `exit ${res.status}`})`);
  process.exit(1);
}
console.log(`Wrote ${out} (${(statSync(out).size / 1e6).toFixed(1)} MB)`);
