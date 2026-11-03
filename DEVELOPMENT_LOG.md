# Development log

## 2026-11-02: Anti-slop pass, startup fix, rename (uncommitted)

**Work completed**

- Startup bug: `scripts/dev.mjs` starts Vite only after the API answers, so the page can no longer
  load before the API. Measured: API listening at 3.9 s, Vite at 4.7 s, first requests 200.
- Renamed the sample product from Nova to SIEdits everywhere, and the example to
  `examples/siedits-launch.project.json`. Scene timings are unchanged.
- Editor restyled: neutral graphite, one tungsten accent (`#d98a3d`), square corners, no gradients,
  glow or cards. SVG icons replace text glyphs (`src/editor/components/icons.tsx`). Rainbow layer
  badges removed.
- Home is now a dense project table with a side panel. Button reads "Create project".
- Generated videos: all five moods are flat with solid backgrounds, no glow and no particles. Purple
  and pink-on-purple palettes replaced. The generated logo mark is a flat fill.
- Default brief no longer asks for glowing typography.
- `tests/style-rules.test.ts` fails if gradients, glow, purple, large radii, extra shadows, text
  glyph icons or non-flat default moods come back.

**Rejected in critique:** form fields stretched to full height (fixed), Format dropdown clipped
(moved to its own row), lowercase cramped layer labels and a truncated field label (fixed).

**Tests executed** (Windows, Chrome): typecheck pass, Vitest 121/121, build pass, Playwright 3/3
including a real MP4 export. Parity worst values: mean 1.10, 0.129% of pixels off by more than 32.

**Errors encountered**

- A cold-start check reported 60 s. The cause was the socket probe in the test script, not the
  fix; re-measured with `Get-NetTCPConnection`.

**Known limitations**

- The layout is still the scene-based editor: no toolbar, rulers, tracks or resizable panels (M3).
- Gradients, glow and particles remain as options a user can add on purpose. They are no longer
  defaults.
- Projects saved earlier keep their old colours. Regenerate or pick a palette to update them.
- The accent colour is a proposal, not yet checked over real footage.
- Ctrl+C in a real console now tested: both servers stop with no leftover processes.

## 2026-11-02: M0, solid ground (uncommitted)

**Work completed**

- All npm scripts now run on Windows. `dev` and `start` no longer rely on npx or POSIX env syntax;
  e2e setup moved to `scripts/e2e-server.mjs`.
- API: every request checks Host and Origin (`src/server/guards.ts`). All body-reading routes
  have size limits, enforced while reading. Malformed `x-filename` returns 400.
- Vite proxy keeps the browser's Host, which the Origin check depends on.
- Editor: Ctrl+Y redoes. Selection and outlines follow rotation (`src/engine/hit-test.ts`).
- `npm run licenses` reads licenses from `npm ls --long` rather than files; removed a silent
  `catch {}` that reported UNKNOWN on failure.
- Added preview/export parity test, CI workflow, and new config options
  (`ALLOWED_HOSTS`, `MAX_JSON_MB`, `MAX_IMPORT_MB`).
- README says "matching frames", not "identical", which is what was measured.

**Files changed**

- Modified: `.env.example`, `CONTRIBUTING.md`, `README.md`, `e2e/workflow.spec.ts`, `package.json`,
  `playwright.config.ts`, `scripts/dev.mjs`, `scripts/license-report.mjs`,
  `src/editor/components/Editor.tsx`, `src/editor/components/Preview.tsx`, `src/engine/render.ts`,
  `src/engine/types.ts`, `src/server/app.ts`, `src/server/config.ts`, `src/server/index.ts`,
  `tests/render.test.ts`, `tests/server.test.ts`, `vite.config.ts`.
- Added: `.github/workflows/ci.yml`, `e2e/editor-input.spec.ts`, `e2e/parity-frames.ts`,
  `e2e/parity.spec.ts`, `scripts/e2e-server.mjs`, `scripts/start.mjs`, `src/engine/hit-test.ts`,
  `src/server/guards.ts`, `tests/hit-test.test.ts`.

**Dependencies:** none added or removed.

**Decisions**

- The Origin check requires Origin to equal Host, so another app on a different localhost port
  is also refused. GET requests without an Origin are allowed; no GET route changes state.
- Parity is a budget, not equality: mean difference under 3/255 and under 0.5% of pixels off by
  more than 32. Reference run worst values: 1.61 and 0.137%.
- Default limits: JSON 16 MB, import 256 MB. A bundle above 256 MB now gets a 413; raise
  `MAX_IMPORT_MB` if needed.

**Tests executed** (Windows, Node 24.16, fresh `npm ci` in a clean copy, Chrome as the browser)

- Typecheck pass, Vitest 109/109 (was 93), build pass, `npm audit` 0, licenses 97 packages.
- Playwright 3/3 through `npm run test:e2e`.
- `npm run dev`: real browser created a project through the proxy, 14 fonts, no console errors.
  Cross-site POST refused. Stopping Vite also stops the API.
- `npm start`: serves the editor, same results.
- Mutation check: 9 deliberate breakages (8 fixes reverted, plus a simulated renderer drift) each
  turned a test red.

**Errors encountered**

- The Origin check broke the whole app under `npm run dev`, because Vite's proxy rewrites Host by
  default. Unit tests could not see this; the parity spec caught it. Fixed in `vite.config.ts`.
- `licenses` reported 97 UNKNOWN from a path containing a UUID, which npm masks.
- Parity spec first dialled 127.0.0.1 while Vite bound to `::1`.

**Not done**

- Real footage test set: needs clips from the owners. **This M0 item is open.**
- CI has never run: it needs a push. macOS and Linux remain unverified until it does.
- Ctrl+C in a real console was not exercised; the shutdown path was tested by stopping Vite.
- FFmpeg still isn't installed on this machine; tests used a temporary copy.

## 2026-11-02: Initial audit (no product code changed)

**Work completed**

- Cloned `syedmukheeth/SIEdits` at `8fd3365` into the existing empty `SIEdits` folder.
- Read the product source and spikes, ran the gates, drove the app, and benchmarked export.
- Wrote the `research/` documents.
- Added the anti-AI-slop requirement to the plan as `research/UX_AND_DESIGN_SYSTEM.md`.

**Files changed**

- Added `DEVELOPMENT_LOG.md` and `research/*` (untracked; `research/` is gitignored upstream).
- No tracked file modified. Nothing committed or pushed.
- Generated, gitignored: `node_modules/`, `dist/`, `.tmp/`.

**Dependencies**

- None added to the repo. `ffmpeg-static` and `ffprobe-static` were installed in a session scratch
  folder for testing, and placed on PATH per process. **FFmpeg is still not installed on this
  machine**, so tests touching it need it installed.

**Architecture decisions (proposed, not yet agreed)**

- Timeline-rooted format v2; one ops layer; server-side history.
- Node + FFmpeg is the primary export. Browser export demoted, based on 0.89× vs 2.78× measured.
- Rejected Remotion, GSAP, Essentia, YOLO, MusicGen weights by default on license grounds.

**Tests executed**

- Typecheck: pass. Vitest: 93/93. Build: pass. `npm audit`: 0.
- Playwright: pass only with a manual server and scratch config.
- MCP spike smoke: 9/9.
- Spike A: 2.78× real time, valid output, gate fails.
- Preview/export pixel diff: near-identical, not identical.

**Errors encountered**

- `npm run dev`, `start`, `test:e2e`, `licenses` all fail on Windows.
- API accepts cross-origin writes and foreign Host headers.
- Malformed `x-filename` returns 500. Frame rates like 29.97 rejected. Ctrl+Y does nothing.

**Not done**

- Real footage, real AI provider, real MCP clients, spike B, other browsers, other machines.

**Next:** M0 in `research/UPDATED_IMPLEMENTATION_ROADMAP.md`, awaiting go-ahead.
