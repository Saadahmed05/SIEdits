/**
 * Spike A: export a captioned, graphics-overlaid 9:16 reel from footage entirely in the browser.
 * Mediabunny's Conversion does decode → crop/scale → our `process` hook → encode → MP4 mux;
 * the hook draws captions and SceneWright graphics with the same Canvas 2D code as the preview.
 *
 * Audio uses the browser's own AAC encoder. Where WebCodecs has no AAC we fall back to Opus
 * rather than @mediabunny/aac-encoder (a WASM build of FFmpeg's encoder with open
 * LGPL/patent questions), and the gate reports the fallback.
 */
import {
  ALL_FORMATS,
  BlobSource,
  BufferSource,
  BufferTarget,
  CanvasSink,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
  canEncodeAudio,
  canEncodeVideo,
} from 'mediabunny';
import { $, createSpikeEnv, formatBytes, loadEngineFonts, pickSource, report } from '../shared/browser';
import { drawCaptions, paginate, BOLD_POP } from '../shared/captions';
import { demoOverlays, drawOverlays } from '../shared/overlay';
import { parseWords, syntheticWords, type Word } from '../shared/words';

const fileInput = $('file') as HTMLInputElement;
const wordsInput = $('words') as HTMLInputElement;
const status = $('status');
const progress = $('progress') as HTMLProgressElement;
const resultEl = $('result');
const player = $('player') as HTMLVideoElement;
const download = $('download') as HTMLAnchorElement;
const exportButton = $('export') as HTMLButtonElement;
const decodeButton = $('decode') as HTMLButtonElement;

const num = (id: string) => Number(($(id) as HTMLInputElement).value);

/** Decode a few frames of the exported file into one strip, to eyeball captions and graphics. */
async function contactSheet(input: Input, times: number[]): Promise<void> {
  const track = await input.getPrimaryVideoTrack();
  if (!track) return;
  const sheet = $('sheet') as HTMLCanvasElement;
  const thumbW = 216;
  const thumbH = Math.round((thumbW * (await track.getDisplayHeight())) / (await track.getDisplayWidth()));
  sheet.width = thumbW * times.length;
  sheet.height = thumbH;
  const ctx = sheet.getContext('2d')!;
  const sink = new CanvasSink(track, { width: thumbW, height: thumbH, fit: 'fill' });
  let i = 0;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    if (frame) ctx.drawImage(frame.canvas, i * thumbW, 0);
    i++;
  }
  sheet.hidden = false;
}

async function loadWords(): Promise<{ words: Word[] | null; source: string }> {
  const file = wordsInput.files?.[0];
  if (file) return { words: parseWords(JSON.parse(await file.text())), source: file.name };
  const src = new URLSearchParams(location.search).get('words');
  if (src) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`could not fetch ${src}: HTTP ${res.status}`);
    return { words: parseWords(await res.json()), source: src };
  }
  return { words: null, source: 'synthetic' };
}

/** Centre crop of the source that matches the output aspect ratio. */
function centerCrop(srcW: number, srcH: number, outW: number, outH: number) {
  const aspect = outW / outH;
  let width = srcW;
  let height = srcH;
  if (srcW / srcH > aspect) width = Math.round(srcH * aspect);
  else height = Math.round(srcW / aspect);
  // H.264 wants even dimensions.
  width -= width % 2;
  height -= height % 2;
  return { left: Math.floor((srcW - width) / 2), top: Math.floor((srcH - height) / 2), width, height };
}

async function capabilities(width: number, height: number) {
  const [avc, aacNative, opus] = await Promise.all([
    canEncodeVideo('avc', { width, height }),
    canEncodeAudio('aac'),
    canEncodeAudio('opus'),
  ]);
  return { avc, aacNative, opus, userAgent: navigator.userAgent };
}

async function exportReel() {
  const source = await pickSource(fileInput);
  if (!source) throw new Error('choose a video file (or pass ?src=)');
  const [outW, outH] = (($('size') as HTMLSelectElement).value.split('x').map(Number) as [number, number]);
  const fps = num('fps');
  const start = num('start');
  const length = num('length');
  const transcodeAudio = ($('transcode-audio') as HTMLInputElement).checked;

  status.textContent = 'Loading fonts…';
  await loadEngineFonts();
  const caps = await capabilities(outW, outH);
  if (!caps.avc) throw new Error('this browser cannot encode H.264 (WebCodecs avc) at this size');
  const audioCodec = caps.aacNative ? 'aac' : caps.opus ? 'opus' : null;
  if (!audioCodec) throw new Error('this browser can encode neither AAC nor Opus audio');

  const input = new Input({ source: new BlobSource(source.blob), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error('no video track in the file');
  const audio = await input.getPrimaryAudioTrack();
  const srcW = await video.getDisplayWidth();
  const srcH = await video.getDisplayHeight();
  const srcDuration = await input.computeDuration();
  const end = Math.min(srcDuration, start + length);

  const { words: loaded, source: wordsSource } = await loadWords();
  const words = loaded ?? syntheticWords(end - start, start);
  const pages = paginate(words, BOLD_POP.maxWordsPerPage);
  const overlays = demoOverlays(outW, outH, fps);
  const env = createSpikeEnv();

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  let firstSampleTime: number | null = null;
  let frames = 0;
  let drawMs = 0;

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start, end },
    video: {
      crop: centerCrop(srcW, srcH, outW, outH),
      width: outW,
      height: outH,
      fit: 'fill',
      frameRate: fps,
      codec: 'avc',
      quality: QUALITY_HIGH,
      forceTranscode: true,
      process: (sample) => {
        const t0 = performance.now();
        firstSampleTime ??= sample.timestamp;
        // Sample timestamps are on the output clock (0 = trim start); words are on the source clock.
        const outT = sample.timestamp;
        sample.draw(ctx, 0, 0, outW, outH);
        drawCaptions(ctx, pages, start + outT, outW, outH);
        drawOverlays(ctx, overlays, outT, env);
        frames++;
        drawMs += performance.now() - t0;
        return canvas;
      },
    },
    // Copying (no re-encode) only works when the source is already in the target codec.
    audio: { codec: audioCodec, quality: QUALITY_HIGH, forceTranscode: transcodeAudio },
  });
  if (!conversion.isValid) {
    throw new Error(`conversion invalid: ${JSON.stringify(conversion.discardedTracks.map((d) => d.reason))}`);
  }
  conversion.onProgress = (p) => {
    progress.value = p;
    status.textContent = `Exporting… ${(p * 100).toFixed(0)}%`;
  };

  status.textContent = 'Exporting…';
  const t0 = performance.now();
  await conversion.execute();
  const seconds = (performance.now() - t0) / 1000;
  const bytes = output.target.buffer!;

  // Read the result back to prove it is a valid H.264 + AAC MP4 of the right size and length.
  const check = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const outVideo = await check.getPrimaryVideoTrack();
  const outAudio = await check.getPrimaryAudioTrack();
  const outputDuration = await check.computeDuration();
  const videoStats = outVideo ? await outVideo.computePacketStats() : null;

  const exported = end - start;
  const realtimeFactor = seconds / exported;
  const aacOut = outAudio?.codec === 'aac';
  const result = {
    gate: {
      metric: 'export time / video length, with AAC audio',
      value: Number(realtimeFactor.toFixed(3)),
      aac: aacOut,
      pass: realtimeFactor <= 1 && aacOut,
    },
    input: { file: source.name, width: srcW, height: srcH, codec: video.codec, duration: Number(srcDuration.toFixed(2)), audioCodec: audio?.codec ?? null },
    export: {
      seconds: Number(seconds.toFixed(2)),
      exportedSeconds: Number(exported.toFixed(2)),
      framesProcessed: frames,
      overlayDrawMsPerFrame: Number((drawMs / Math.max(1, frames)).toFixed(2)),
      firstSampleTimestamp: firstSampleTime,
      captions: { source: wordsSource, words: words.length, pages: pages.length },
      audioTranscoded: transcodeAudio,
      audioEncoder: caps.aacNative ? 'webcodecs aac' : 'webcodecs opus (no native AAC)',
    },
    output: {
      bytes: bytes.byteLength,
      size: formatBytes(bytes.byteLength),
      width: outVideo ? await outVideo.getDisplayWidth() : null,
      height: outVideo ? await outVideo.getDisplayHeight() : null,
      videoCodec: outVideo?.codec ?? null,
      audioCodec: outAudio?.codec ?? null,
      audioSampleRate: outAudio ? await outAudio.getSampleRate() : null,
      duration: Number(outputDuration.toFixed(3)),
      frames: videoStats?.packetCount ?? null,
      fps: videoStats ? Number(videoStats.averagePacketRate.toFixed(2)) : null,
    },
    capabilities: caps,
  };
  report(resultEl, result);
  await contactSheet(check, [1, 5.5, 15.5, Math.max(0, outputDuration - 1)]);

  const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  player.src = url;
  download.href = url;
  download.download = 'siedits-spike-a.mp4';
  download.hidden = false;
  const summary = `${realtimeFactor.toFixed(2)}× real time, ${outAudio?.codec ?? 'no'} audio`;
  status.innerHTML = result.gate.pass ? `<span class="pass">PASS</span> ${summary}` : `<span class="fail">FAIL</span> ${summary}`;
}

/** Decode every frame of the file (no drawing, no encoding) to measure raw decode throughput. */
async function decodeAll() {
  const source = await pickSource(fileInput);
  if (!source) throw new Error('choose a video file (or pass ?src=)');
  const input = new Input({ source: new BlobSource(source.blob), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error('no video track in the file');
  const duration = await input.computeDuration();
  const sink = new VideoSampleSink(video);
  status.textContent = 'Decoding…';
  const t0 = performance.now();
  let frames = 0;
  for await (const sample of sink.samples()) {
    frames++;
    if (frames % 30 === 0) progress.value = sample.timestamp / duration;
    sample.close();
  }
  const seconds = (performance.now() - t0) / 1000;
  const result = {
    decode: {
      file: source.name,
      width: await video.getDisplayWidth(),
      height: await video.getDisplayHeight(),
      codec: video.codec,
      duration: Number(duration.toFixed(2)),
      frames,
      seconds: Number(seconds.toFixed(2)),
      decodeFps: Number((frames / seconds).toFixed(1)),
      realtimeFactor: Number((seconds / duration).toFixed(3)),
    },
  };
  report(resultEl, result);
  progress.value = 1;
  status.textContent = `Decoded ${frames} frames in ${seconds.toFixed(1)} s (${(frames / seconds).toFixed(0)} fps)`;
}

function guard(button: HTMLButtonElement, run: () => Promise<void>) {
  button.addEventListener('click', async () => {
    exportButton.disabled = decodeButton.disabled = true;
    progress.value = 0;
    try {
      await run();
    } catch (err) {
      console.error(err);
      status.innerHTML = `<span class="fail">Error</span> ${(err as Error).message}`;
      report(resultEl, { error: (err as Error).message });
    } finally {
      exportButton.disabled = decodeButton.disabled = false;
    }
  });
}

guard(exportButton, exportReel);
guard(decodeButton, decodeAll);
