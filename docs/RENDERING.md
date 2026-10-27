# Rendering workflow

## Pipeline

```
project JSON ──▶ validateForRender ──▶ assertFfmpegReady ──▶ load fonts + images
                  (schema, even dims,      (ffmpeg -version,        (@fontsource woff2,
                   referenced assets)       libx264 present)          PNG/JPEG/WebP)
     ──▶ for each frame n:  renderFrame(ctx, project, n / fps)  on a Skia canvas (@napi-rs/canvas)
                            ctx.getImageData → raw RGBA → ffmpeg stdin (back-pressure aware)
     ──▶ ffmpeg -f rawvideo -pix_fmt rgba … -c:v libx264 -pix_fmt yuv420p -movflags +faststart out.partial-xxxx.mp4
     ──▶ ffprobe -count_frames: codec, size, frame count must match the project
     ──▶ rename to final path
```

The browser preview calls the same `renderFrame` on an HTML canvas and loads the same font
files from `/fonts/…`, so what you see in the editor is what is exported.

Properties guaranteed by the implementation (and covered by `tests/render.test.ts`):

- **Validation before work.** Invalid projects, odd dimensions and missing referenced asset
  files are reported before FFmpeg starts (`INVALID_PROJECT`, `INVALID_PARAMS`,
  `MISSING_ASSET`), with field paths.
- **Verified output.** A render only succeeds if ffprobe can decode every frame and the size
  and frame count match.
- **Atomic output and cleanup.** Frames are encoded to `*.partial-*.mp4`; on success it is
  renamed, on failure or cancellation it is deleted and FFmpeg is killed.
- **Determinism.** No randomness or wall-clock time enters a frame: particles use a seeded
  PRNG and all motion is a pure function of time.

## Error codes

| Code | Meaning | HTTP status |
|---|---|---|
| `INVALID_PROJECT` | Schema validation failed | 422 |
| `INVALID_PARAMS` | Can't encode these settings (e.g. odd width) | 422 |
| `MISSING_ASSET` | A referenced image file is missing or undecodable | 422 |
| `FFMPEG_NOT_FOUND` | FFmpeg not installed / no libx264 | 503 |
| `ENCODER_FAILED` | FFmpeg exited non-zero (stderr tail included) | job `failed` |
| `VERIFY_FAILED` | Output unreadable or doesn't match the project | job `failed` |
| `CANCELLED` | Cancelled by the user | job `cancelled` |

## From the editor

**Render MP4** saves pending edits, validates, and queues a job. Jobs run one at a time on a
snapshot of the project taken when queued; the Render tab polls progress, offers Cancel, and
shows the verified result (size, frames, duration) with a player and download link. Files are
written to `DATA_DIR/renders/<projectId>/<jobId>.mp4` and served with HTTP range support.

## From the command line

```bash
npm run render -- examples/nova-launch.project.json out/nova.mp4
npm run render -- my-export.scenewright.json out/video.mp4          # bundles carry their images
npm run render -- project.json out.mp4 --assets ./path/to/assets     # plain files + asset dir
```

## Performance (measured in this repository's CI-like container, 4 vCPUs)

| Project | Output | Wall time |
|---|---|---|
| Nova example | 1920×1080, 30 fps, 360 frames | 12.2 s (~1× real time) |
| Smoke test | 640×360, 24 fps, 146 frames | 1.1 s |

Rendering is single-threaded per job (Skia drawing + an x264 process). Parallel chunked
rendering is on the roadmap.

## Requirements

- Node.js 22+
- FFmpeg with libx264 (`ffmpeg -encoders | grep libx264`). Set `FFMPEG_PATH`/`FFPROBE_PATH`
  if the binaries are not on `PATH`.
- glibc ≥ 2.18 (Linux) for the prebuilt Skia binary; macOS and Windows binaries are
  published by `@napi-rs/canvas` but have not been tested in this project yet.
