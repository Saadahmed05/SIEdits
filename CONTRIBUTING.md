# Contributing to SceneWright

Thanks for helping! This project values small, verifiable changes.

## Setup

```bash
npm install
npm run dev          # API :8787 + editor :5173
npm run typecheck && npm test
```

FFmpeg with libx264 must be installed for render tests. For browser tests:
`npm run test:e2e` (set `PW_CHROMIUM_PATH` to reuse an installed Chromium).

## Ground rules

- **Model output is data, never code.** Do not add features that evaluate expressions,
  HTML, scripts or URLs from projects or AI responses. New capabilities go through the
  schema (`src/project/schema.ts`) with strict validation and bounded values.
- **Keep the engine pure.** `src/engine` must not use `Math.random`, `Date`, network or the
  file system: frames are pure functions of the project and time, so preview equals export.
- **No AI required.** Every feature must work with the offline planner; AI paths need a
  fallback and a user-visible reason when they fail.
- **Explicit errors.** Don't swallow exceptions; surface them with a code and field paths.
- **Licenses.** New runtime dependencies must be OSI-licensed and compatible with
  Apache-2.0 (MIT, BSD, Apache, ISC, MPL-2.0 for unmodified files). Run `npm run licenses`
  and update `research/LICENSE_AND_DEPENDENCY_AUDIT.md`. No GPL/AGPL code in-process; no
  committed assets without a clear license; no model weights in the repository.
- **Tests.** Add or update tests for behaviour changes. Changes to the project format need
  schema tests, a docs update in `docs/PROJECT_FORMAT.md`, `npm run schema`, and — if
  breaking — a version bump with a migration in `src/project/migrate.ts`.

## Where things go

See [docs/EXTENDING.md](docs/EXTENDING.md) for step-by-step guides to adding animation
primitives, element types, scene kinds, AI providers and templates.

## Pull requests

- One topic per PR, with a short description of user-visible changes and how you tested.
- `npm run typecheck`, `npm test` and (for UI changes) `npm run test:e2e` must pass.
- Include a screenshot or short clip for visual changes.
