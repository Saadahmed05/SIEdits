/// <reference lib="webworker" />
/**
 * Runs Whisper (transformers.js) off the main thread. Receives 16 kHz mono samples, returns
 * word chunks plus timings for model load and transcription.
 */
import { env, pipeline } from '@huggingface/transformers';

export interface TranscribeRequest {
  audio: Float32Array;
  model: string;
  device: 'webgpu' | 'wasm';
  dtype: Record<string, string> | string;
}

export type WorkerMessage =
  | { type: 'status'; text: string }
  | { type: 'progress'; file: string; loaded: number; total: number }
  | {
      type: 'done';
      loadSeconds: number;
      transcribeSeconds: number;
      text: string;
      chunks: { text: string; timestamp: [number, number | null] }[];
    }
  | { type: 'error'; message: string };

env.allowLocalModels = false;
const post = (msg: WorkerMessage) => self.postMessage(msg);

self.onmessage = async (e: MessageEvent<TranscribeRequest>) => {
  const { audio, model, device, dtype } = e.data;
  try {
    post({ type: 'status', text: `Loading ${model} (${device})…` });
    const t0 = performance.now();
    const asr = await pipeline('automatic-speech-recognition', model, {
      device,
      dtype: dtype as never,
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === 'progress' && p.file) post({ type: 'progress', file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
      },
    });
    const loadSeconds = (performance.now() - t0) / 1000;
    post({ type: 'status', text: `Transcribing ${(audio.length / 16000).toFixed(0)} s of audio…` });
    const t1 = performance.now();
    // English-only (.en) checkpoints reject a language option.
    const language = /\.en(_|$)/.test(model) ? {} : { language: 'en' };
    const out = await asr(audio, { return_timestamps: 'word', chunk_length_s: 30, stride_length_s: 5, ...language });
    const transcribeSeconds = (performance.now() - t1) / 1000;
    const result = Array.isArray(out) ? out[0]! : out;
    post({
      type: 'done',
      loadSeconds,
      transcribeSeconds,
      text: result.text,
      chunks: (result.chunks ?? []) as { text: string; timestamp: [number, number | null] }[],
    });
    await asr.dispose();
  } catch (err) {
    post({ type: 'error', message: (err as Error).message ?? String(err) });
  }
};
