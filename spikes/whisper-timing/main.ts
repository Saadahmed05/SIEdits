/**
 * Spike B: are browser Whisper word timestamps good enough for word-highlight captions and
 * text-based cutting? Transcribes in a worker, then scores against a reference transcript.
 */
import { timingReport } from '../shared/align';
import { $, pickSource, report } from '../shared/browser';
import { parseWords, type Word } from '../shared/words';
import type { TranscribeRequest, WorkerMessage } from './worker';

const status = $('status');
const progress = $('progress') as HTMLProgressElement;
const resultEl = $('result');
const runButton = $('run') as HTMLButtonElement;
const download = $('download') as HTMLAnchorElement;
const sample = $('sample') as HTMLTableElement;

const DTYPES: Record<TranscribeRequest['device'], TranscribeRequest['dtype']> = {
  // The settings transformers.js recommends for Whisper on each backend.
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: { encoder_model: 'q8', decoder_model_merged: 'q8' },
};

/** Decode any audio/video the browser understands to 16 kHz mono. */
async function decode16k(blob: Blob, maxSeconds: number): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const length = maxSeconds > 0 ? Math.min(buffer.length, Math.round(maxSeconds * 16000)) : buffer.length;
    const mono = new Float32Array(length);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
    }
    return mono;
  } finally {
    await ctx.close();
  }
}

async function loadReference(): Promise<{ words: Word[]; name: string } | null> {
  const file = ($('ref') as HTMLInputElement).files?.[0];
  if (file) return { words: parseWords(JSON.parse(await file.text())), name: file.name };
  const src = new URLSearchParams(location.search).get('ref');
  if (!src) return null;
  const res = await fetch(src);
  if (!res.ok) throw new Error(`could not fetch ${src}: HTTP ${res.status}`);
  return { words: parseWords(await res.json()), name: src };
}

function transcribe(request: TranscribeRequest): Promise<Extract<WorkerMessage, { type: 'done' }>> {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timer = setInterval(() => {
      if (status.dataset.phase === 'transcribe') status.textContent = `Transcribing… ${((performance.now() - started) / 1000).toFixed(0)} s`;
    }, 1000);
    const finish = () => {
      clearInterval(timer);
      worker.terminate();
    };
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === 'status') {
        status.textContent = msg.text;
        status.dataset.phase = msg.text.startsWith('Transcribing') ? 'transcribe' : 'load';
      } else if (msg.type === 'progress' && msg.total) progress.value = msg.loaded / msg.total;
      else if (msg.type === 'done') {
        finish();
        resolve(msg);
      } else if (msg.type === 'error') {
        finish();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message));
    };
    worker.postMessage(request, [request.audio.buffer]);
  });
}

function showSample(ref: Word[] | null, hyp: Word[]) {
  const rows = hyp.slice(0, 25).map((h, i) => {
    const r = ref?.[i];
    return `<tr><td>${h.text}</td><td>${h.start.toFixed(2)}</td><td>${r ? `${r.text} @ ${r.start.toFixed(2)}` : ''}</td></tr>`;
  });
  sample.innerHTML = `<tr><th>Whisper</th><th>start</th><th>reference (by index)</th></tr>${rows.join('')}`;
}

runButton.addEventListener('click', async () => {
  runButton.disabled = true;
  progress.value = 0;
  try {
    const source = await pickSource($('file') as HTMLInputElement);
    if (!source) throw new Error('choose an audio/video file (or pass ?src=)');
    const device = ($('device') as HTMLSelectElement).value as TranscribeRequest['device'];
    const model = ($('model') as HTMLSelectElement).value;
    const length = Number(($('length') as HTMLInputElement).value);
    if (device === 'webgpu' && !('gpu' in navigator)) throw new Error('WebGPU is not available in this browser');

    status.textContent = 'Decoding audio…';
    const audio = await decode16k(source.blob, length);
    const seconds = audio.length / 16000;
    const done = await transcribe({ audio, model, device, dtype: DTYPES[device] });
    const hyp = parseWords(done.chunks);

    const reference = await loadReference();
    const refWords = reference ? reference.words.filter((w) => w.start < seconds) : null;
    const timing = refWords ? timingReport(refWords, hyp) : null;
    const pass = timing ? timing.withinTolerance >= 0.9 && timing.matchRate >= 0.9 : null;
    const result = {
      gate: {
        metric: 'share of matched word starts within ±100 ms (need ≥ 0.9, with ≥ 0.9 of words matched)',
        value: timing?.withinTolerance ?? null,
        pass,
      },
      run: {
        file: source.name,
        audioSeconds: Number(seconds.toFixed(1)),
        model,
        device,
        dtype: DTYPES[device],
        loadSeconds: Number(done.loadSeconds.toFixed(1)),
        transcribeSeconds: Number(done.transcribeSeconds.toFixed(1)),
        realtimeFactor: Number((done.transcribeSeconds / seconds).toFixed(3)),
        words: hyp.length,
        wordsWithoutEnd: done.chunks.filter((c) => c.timestamp[1] === null).length,
      },
      timing,
      reference: reference?.name ?? null,
      textSample: done.text.slice(0, 300),
    };
    report(resultEl, result);
    showSample(refWords, hyp);
    const url = URL.createObjectURL(new Blob([JSON.stringify({ model, device, words: hyp }, null, 2)], { type: 'application/json' }));
    download.href = url;
    download.download = `whisper-words-${device}.json`;
    download.hidden = false;
    progress.value = 1;
    status.innerHTML =
      pass === null
        ? `Done in ${done.transcribeSeconds.toFixed(0)} s (no reference to score against)`
        : `${pass ? '<span class="pass">PASS</span>' : '<span class="fail">FAIL</span>'} ${(timing!.withinTolerance * 100).toFixed(1)}% within ±100 ms, median ${timing!.medianAbsMs} ms`;
  } catch (err) {
    console.error(err);
    status.innerHTML = `<span class="fail">Error</span> ${(err as Error).message}`;
    report(resultEl, { error: (err as Error).message });
  } finally {
    runButton.disabled = false;
  }
});
