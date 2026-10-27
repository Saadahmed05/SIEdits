# Project format (`scenewright.project`, version 1)

A SceneWright project is a single JSON document. The authoritative definition is the Zod
schema in [`src/project/schema.ts`](../src/project/schema.ts); a generated JSON Schema is in
[`project.schema.json`](project.schema.json) (`npm run schema` regenerates it). Validate any
file with `npm run validate -- file.json`.

The format is designed so that:

- **everything is data** — there is no code, expression language, HTML or URL in a project;
- **unknown keys are rejected** everywhere (strict objects), so a file cannot smuggle in
  unsupported behaviour;
- **projects are resolution-independent** — positions and sizes are fractions of the frame;
- **brand changes propagate** — colors can reference brand tokens.

## Top level

```jsonc
{
  "format": "scenewright.project",   // required, fixed
  "version": 1,                      // required; newer versions are refused with a clear error
  "id": "proj_7sm1t3gpqv",           // [A-Za-z0-9_-]{1,64}
  "name": "Nova launch",
  "createdAt": "2026-10-22T00:00:00.000Z",
  "updatedAt": "2026-10-22T00:00:00.000Z",
  "settings": { "width": 1920, "height": 1080, "fps": 30 },
  "brand": { "primary": "#7c5cff", "secondary": "#00d4ff", "accent": "#b9a8ff",
             "background": "#07080d", "text": "#f5f6fa",
             "headingFont": "Inter", "bodyFont": "Inter" },
  "assets": [ /* images, see below */ ],
  "scenes": [ /* 1–50 scenes */ ],
  "render": { "crf": 18, "preset": "veryfast" },  // x264 settings
  "generation": { /* optional: brief, planner, warnings — informational only */ }
}
```

Limits: width/height 16–3840 (must be even to export H.264), fps 1–60, total duration ≤ 600 s,
≤ 50 scenes, ≤ 40 elements per scene, ≤ 8 animations per element.

## Colors and fonts

- A **color** is `#rrggbb`, `#rrggbbaa`, or a brand token: `@primary`, `@secondary`,
  `@accent`, `@background`, `@text`.
- A **font** is one of the bundled families — `Inter`, `Space Grotesk`, `Playfair Display` —
  or `@heading` / `@body` (the brand fonts). Weights: 400, 500, 600, 700, 800 (nearest
  available weight is used if a family lacks one).

## Timing model

```
start[0] = 0
start[i] = start[i-1] + duration[i-1] - transition[i].duration    (transition ≠ "none")
total    = start[last] + duration[last]
frames   = round(total × fps), frame n is rendered at t = n / fps
```

A scene's `transition` describes how it **enters**, overlapping the end of the previous
scene: `none`, `fade`, `slide-left`, `slide-up`, `zoom`, `wipe`. The first scene's
transition is ignored. A transition may not be longer than either neighbouring scene, and a
scene must be long enough for its incoming plus outgoing transitions.

Inside a scene, an element is visible from `start` to `end` (seconds from scene start;
`end: null` = scene end).

## Scenes

```jsonc
{
  "id": "scene-1",
  "name": "1. Title",
  "duration": 3.9,                                   // seconds, 0.1–120
  "background": { "type": "radial-gradient", "cx": 0.5, "cy": 0.35, "vignette": 0.5,
                  "stops": [{ "offset": 0, "color": "#1a1533" }, { "offset": 1, "color": "@background" }] },
  "transition": { "type": "fade", "duration": 0.6 },
  "elements": [ /* drawn in order; later = on top */ ],
  "notes": "Title scene"
}
```

Backgrounds: `solid {color}`, `linear-gradient {angle, stops, rotateSpeed, vignette}`,
`radial-gradient {cx, cy, stops, vignette}` (2–6 stops).

## Elements

Common fields (all optional except `id` and `type`):

| Field | Default | Meaning |
|---|---|---|
| `x`, `y` | 0.5 | Anchor point as a fraction of frame width/height (−1…2 allowed for off-screen) |
| `scale`, `rotation` (deg), `opacity` | 1, 0, 1 | Base transform |
| `start`, `end` | 0, null | Visibility window within the scene |
| `animations` | [] | See below |

| `type` | Specific fields |
|---|---|
| `text` | `text`, `font`, `weight`, `size` (fraction of height), `color`, `align` (x is the left edge / centre / right edge), `letterSpacing` (em), `lineHeight`, `maxWidth` (fraction of width; wraps), `uppercase`, `glow {color, strength}` |
| `shape` | `shape` (`rect`/`ellipse`), `width` (fraction of width), `height` (fraction of height), `fill`, `stroke`, `strokeWidth`, `cornerRadius`, `glow` |
| `image` | `assetId`, `width` (height follows aspect ratio), `cornerRadius`, `shadow` |
| `logo` | `assetId` or `null` (generated monogram + `wordmark`), `size`, `color`, `markColor`, `font`, `glow` |
| `device` | Product screenshot in a frame: `frame` (`browser`/`phone`/`none`), `assetId` or `null` (neutral placeholder UI), `width`, `accent`, `shadow` |
| `particles` | Seeded drifting particles: `count`, `color`, `size`, `speed`, `seed` |

## Animations

One-shot animations have `anchor`, `delay`, `duration`, `easing`:

- `anchor: "start"` — starts `delay` s after the element appears (default for *-in*).
- `anchor: "end"` — finishes `delay` s before the element disappears (default for *-out*),
  so exits stay at the end when you change a scene's duration.

| `type` | Extra fields | Effect |
|---|---|---|
| `fade-in` / `fade-out` | — | opacity 0→1 / 1→0 |
| `slide-in` / `slide-out` | `direction`, `distance` (fraction of frame) | moves *towards* `direction` |
| `scale-in` / `scale-out` | `from` / `to` | scale from→1 / 1→to |
| `zoom` | `from`, `to` | scale from→to (Ken Burns) |
| `rotate-in` | `from` (deg) | rotation from→element rotation |
| `typewriter` | — | text only: reveal characters |
| `tracking-in` | `from` (em) | text only: letter spacing collapses |
| `float` | `amplitude`, `period` | continuous vertical bob |
| `pulse` | `amount`, `period` | continuous scale pulse |
| `spin` | `speed` (deg/s) | continuous rotation |

Easings: `linear`, `ease-in`, `ease-out`, `ease-in-out`, `ease-out-back`, `ease-out-expo`,
`ease-in-out-expo`. Effects compose: opacity and scale multiply, offsets add.

## Assets

```json
{ "id": "asset_k3j2", "kind": "image", "name": "dashboard.png", "file": "asset_k3j2.png",
  "mimeType": "image/png", "width": 2560, "height": 1600 }
```

`file` is a plain file name inside the project's `assets/` directory (no paths). PNG, JPEG
and WebP are accepted; the type is checked from the file's bytes on upload and import.

## Bundles (`scenewright.bundle`)

`GET /api/projects/:id/export` produces a single file containing the project and its assets:

```json
{ "format": "scenewright.bundle", "version": 1, "project": { … },
  "assets": { "asset_k3j2.png": { "mimeType": "image/png", "data": "<base64>" } } }
```

Bundles can be imported in the editor or rendered directly with
`npm run render -- file.scenewright.json out.mp4`.

## Worked example

[`examples/nova-launch.project.json`](../examples/nova-launch.project.json) was produced by
the offline planner from the brief _"Create a 12-second cinematic launch animation for a
fictional SaaS product called Nova…"_ and is interpreted as follows:

| Time | Scene | What you see |
|---|---|---|
| 0.0–3.9 s | `1. Title` | Particles fade in; "Meet Nova" tracks in with a `@primary` glow; an accent line scales in; the subheadline slides up. All exit with an end-anchored fade. |
| 3.3–8.7 s | `2. Product reveal` | Enters with a 0.6 s `zoom` transition. A browser-framed screenshot (placeholder UI until you upload one) slides up and slowly zooms; the headline slides in from the left. |
| 8.1–12.0 s | `3. Logo reveal` | Enters with a 0.6 s `fade`. A ring expands and dissolves; the generated "N" monogram + "Nova" wordmark pops in with `ease-out-back`. |

Total: 3.9 + 5.4 + 3.9 − 0.6 − 0.6 = **12.0 s**, 360 frames at 30 fps.

## Versioning

`version` increments on any breaking change. `src/project/migrate.ts` holds one migration
function per version step operating on plain JSON, so old files keep loading. Files with a
newer version than the running app are rejected with an explicit message, never guessed at.
