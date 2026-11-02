# SIEdits

**A video editor your AI can drive.** Timeline editing plus motion graphics in the browser,
built for talking-head creators. Every cut, caption, zoom and graphic stays an editable,
validated operation, so the user's own AI assistant (Claude, ChatGPT, Codex, Cursor) can edit
through an MCP connector and the user can always undo or tweak what it did.

> Status: **week 1, go/no-go spikes.** The repository is seeded from
> [SceneWright](https://github.com/syedmukheeth/video-editing) v0.1, which already turns a
> brief into a validated scene graph and renders matching frames in preview and export.
> The multitrack timeline, captions and footage import are not built yet.

## How it fits together

- **The user's AI thinks.** Planning and copy come from the user's own assistant calling our
  MCP tools. Every write is a typed, validated op; invalid ops are rejected with a reason.
  Nothing works only with AI: deterministic fallbacks exist for every step.
- **The user's browser renders.** Decode, preview, transcription and standard export run
  client-side (WebCodecs, Mediabunny, Whisper on WebGPU). Cloud rendering is optional.
- **One engine.** Graphics are SceneWright scenes nested on the timeline, drawn by the same
  Canvas 2D engine in the editor, the browser exporter and the Node renderer.

## Week-1 spikes

Each spike answers one go/no-go question before product code is written. See
[spikes/README.md](spikes/README.md) for how to run them and what passing means.

| Spike | Question | Gate | First result (one laptop) |
|---|---|---|---|
| [A: browser export](spikes/browser-export/) | Can Chrome/Edge decode footage, draw captions and graphics, and export a 1080×1920 MP4 with AAC audio? | Export ≤ 1× real time | Valid H.264 + AAC output; 0.91× once, then 2.4–2.7× under sustained load |
| [B: Whisper word timing](spikes/whisper-timing/) | Are Whisper WebGPU word timestamps good enough for word-level captions and text-based cuts? | Word timing within ±100 ms | Fails raw (31%); constant +145 ms lag, 89–92% after correcting; slow on this laptop |
| [C: remote MCP](spikes/mcp-server/) | Can an AI client drive edits through a remote MCP server with typed ops and a preview? | One full agent edit round-trip | Passes locally with the SDK client; OAuth, deploy, Claude/ChatGPT connection still open |

## Quick start (SceneWright editor)

Requirements: **Node.js 22+** and **FFmpeg with libx264**, on Windows, macOS or Linux. If FFmpeg
is not on your PATH, set `FFMPEG_PATH` and `FFPROBE_PATH`.

```bash
npm install
npm run dev            # API on :8787 + editor on http://localhost:5173
npm run typecheck && npm test
npm run build && npm start   # production: editor and API on http://127.0.0.1:8787
```

The API has no accounts, so it only answers requests addressed to this machine from its own
origin. To serve it under another name, set `ALLOWED_HOSTS`.

Optional AI planning: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`, or point
`OPENAI_BASE_URL`/`OPENAI_MODEL` at an OpenAI-compatible server. Without either, the built-in
offline planner is used.

## Layout

```
src/
  project/     schema (Zod, v1) · migrations · bundles · pure edit operations · colors
  engine/      timeline · easing · animation primitives · drawing · renderFrame (Canvas 2D)
  storyboard/  storyboard schema · moods · scene-kind compilers · templates
  ai/          planner providers · offline heuristic planner · validate-or-fall-back
  render/      Node renderer on @napi-rs/canvas (Skia) + FFmpeg
  server/      Hono API · file storage · render job queue
  editor/      React 19 editor (Vite)
  cli/         render · validate
spikes/        week-1 go/no-go experiments (not product code)
tests/ e2e/    Vitest · Playwright
docs/          SceneWright v1 project format · rendering · extending · JSON Schema
```

## Documentation

- [Project format v1](docs/PROJECT_FORMAT.md) and [JSON Schema](docs/project.schema.json)
- [Rendering workflow](docs/RENDERING.md)
- [Extending the engine](docs/EXTENDING.md)

## License

Code carried over from SceneWright is Apache-2.0: see [LICENSE](LICENSE) and
[NOTICE](NOTICE). Bundled fonts are OFL-1.1.
