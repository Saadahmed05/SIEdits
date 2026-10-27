# Week-1 spikes

Three go/no-go experiments from the roadmap. Each one answers one question with a number.
They are throwaway code: product code will be rewritten from what they teach. Shared pieces
that will survive (word timings, captions, callout templates, typed reel ops) live in
[`shared/`](shared/) and [`mcp-server/reel.ts`](mcp-server/reel.ts) and are unit-tested in
[`tests/spikes.test.ts`](../tests/spikes.test.ts).

## Fixtures

Generated locally into `.tmp/fixtures/` (gitignored), no downloads:

```bash
powershell -File spikes/fixtures/make-speech.ps1          # 10 min TTS speech + reference word times (Windows)
node spikes/fixtures/make-footage.mjs 10                  # 10 min 1080p30 H.264 + AAC, using that speech
```

The reference word times are the Windows speech engine's own `SpeakProgress` positions.
Checked against the audio: after each pause the waveform onset lands within 15 ms (median) /
50 ms (p90) of the engine's time, so the reference is good to roughly ±50 ms. It is still
synthetic speech: real recordings need hand-labelled or forced-aligned references before
the timing result is final.

## Running

```bash
npm run dev:web    # Vite on http://localhost:5173
```

- Spike A: <http://localhost:5173/spikes/browser-export/index.html?src=/.tmp/fixtures/talking-10min-1080p.mp4&words=/.tmp/fixtures/speech.words.json>
- Spike B: <http://localhost:5173/spikes/whisper-timing/index.html?src=/.tmp/fixtures/speech.wav&ref=/.tmp/fixtures/speech.words.json>
- Spike C: `node --import tsx spikes/mcp-server/index.ts`, then `npx tsx spikes/mcp-server/smoke.ts`

Each page prints its result as JSON (also on `window.__spikeResult`). Keep the browser tab
visible while timing: background tabs are throttled and the numbers become meaningless.

## Results (2026-10-27)

Machine: Windows 11 laptop, Intel i5-1135G7 (4 cores / 8 threads, Iris Xe GPU), on AC power,
in the Claude desktop app's built-in Chromium 152 browser. One machine only: rerun on Chrome,
Edge, macOS and a low-end laptop before deciding.

### A: browser export, **unstable: passed once, then 2.4–2.7×**

Mediabunny `Conversion` decodes, crops 16:9 → 9:16, calls our `process` hook (captions +
SceneWright callouts on Canvas 2D), encodes H.264 + AAC with WebCodecs and muxes MP4.
Every output was valid: H.264 1080×1920, 1,800 frames @ 30 fps, 60.01 s, AAC 48 kHz (read
back with Mediabunny; contact sheet shows captions, hook title, lower third, stat card).

| Run (60 s export → 1080×1920 unless noted) | Time | × real time | Overlay ms/frame |
|---|---|---|---|
| Decode only, full 10 min 1080p30 | 28.8 s (625 fps) | 0.05 | — |
| 1. AAC re-encoded, tab hidden part of the time | 90.1 s | 1.50 (throttled, discard) | 1.24 |
| 2. AAC re-encoded, tab visible | 54.9 s | **0.91 PASS** | 1.24 |
| 3. Same, page cross-origin isolated | 160.0 s | 2.67 | — |
| 4. Same, isolation off again | 143.9 s | 2.40 | 2.26 |
| 5. Audio copied, not re-encoded | 154.6 s | 2.58 | 5.37 |
| 720×1280 (stopped at 39% after ~90 s) | — | ≈ 3.8 | — |

Reading the table:
- **Not a codec or isolation problem.** Runs 3–5 slowed down whatever changed, and even the
  pure-CPU overlay drawing got 2–4× slower. That points to the laptop throttling after ~40
  minutes of sustained load. 720p was no faster than 1080p, so pixel count isn't the limit.
- **Decode is not the bottleneck** (20× headroom). The cost is canvas → `VideoFrame`
  readback plus H.264 encode on the main thread.
- **Next:** move the composite into an `OffscreenCanvas` in a worker; try
  `hardwareAcceleration: 'prefer-hardware'` and a lower quality preset; log encoder queue
  depth; measure on a cold machine and on other hardware. If it stays above 1×, the
  roadmap fallback applies (cloud render for long videos).
- Native WebCodecs AAC worked here, so no WASM AAC encoder is needed. That encoder
  (`@mediabunny/aac-encoder`, an FFmpeg build) has open LGPL/patent questions, so the spike
  falls back to Opus instead and the gate reports it.

### B: Whisper word timing, **FAIL as specified; passes the 30 s probes with one constant correction**

`onnx-community/whisper-base.en_timestamped` via transformers.js 4.3, `return_timestamps:
'word'`, 30 s chunks with 5 s stride, scored against the reference word starts.

| Run | Speed (× real time) | Words matched | Median error | Within ±100 ms | Bias | Within ±100 ms after bias |
|---|---|---|---|---|---|---|
| WebGPU, 30 s | 2.93 (+51 s load) | 98.7% | 130 ms | 27% | +144 ms | 91% |
| WASM, 30 s | 0.79 (+34 s first load) | 98.7% | 130 ms | 28% | +144 ms | 92% |
| WASM, full 549 s | 1.92 | 97.1% (1,459 / 1,503) | 135 ms | 31% (p90 240 ms) | +145 ms | 88.7% |
| WASM, 30 s, cross-origin isolated | 1.11 | 98.7% | 130 ms | 28% | +144 ms | 92% |

- **WebGPU word timestamps work** (no failure like the ones reported upstream), but on this
  integrated GPU they are 3.7× slower than WASM.
- **Whisper starts words ~145 ms late, consistently** (same bias on every run and over
  9 minutes). Raw timing fails the gate; subtracting a constant brings it to 89–92%, right
  at the 90% bar. Captions would look fine; cutting on word edges needs the correction.
- **Too slow for a 10-minute video in the browser on this laptop:** ~18 min single-threaded.
  Making the page cross-origin isolated (needed for WASM threads, see `vite.config.ts`) did
  not speed it up in one run. Thread use needs profiling.
- **Next:** check the +145 ms offset on real human speech (a WhisperX or hand-labelled
  reference), try `whisper-tiny.en` for speed, profile threading. If browser speed stays
  above ~1×, use the roadmap fallback: server-side faster-whisper/WhisperX for paid users.

### C: remote MCP, **PASS locally (OAuth and real clients not done)**

Stateless Streamable HTTP server on Hono + the SDK's web-standard transport (same code can
run on Cloudflare Workers). Nine tools: `list_projects`, `get_project_outline`,
`get_transcript`, `list_templates`, `apply_ops`, `run_autopilot`, `lint_project`, `undo`,
`render_preview`. Every tool has a `title` and `readOnlyHint`/`destructiveHint` (Claude
directory requirement).

`smoke.ts` drives it with the official SDK client the way an agent would: 9/9 checks pass,
twice in a row on one server:

- reads the transcript, then applies hook title + cut + zoom + list callout in one batch
- a batch with a mid-word cut and over-long text is rejected as a whole, with one reason per
  failing op (e.g. `cut start 0.9675 splits the word "want" (0.84–1.095)`)
- a stale `baseRevision` is refused; `undo` reverts the whole batch
- `render_preview` returns a PNG drawn server-side (FFmpeg frame + Skia) with the same
  caption and callout code as the browser export

Still open for the gate:
1. Public HTTPS deployment + OAuth 2.0 (required by Claude custom connectors).
2. Connect from Claude (free plan allows one custom connector) and from ChatGPT **Plus**,
   whose MCP access is unconfirmed.
3. MCP App inline preview (`ui://` resource). Fallback if blocked: a preview link to our app.
