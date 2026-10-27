# Extending SceneWright

Every extension point is a typed registry. TypeScript's exhaustiveness checks (`{ [T in …] }`
mapped types) tell you exactly which places still need code when you add a new kind of thing.

## Add an animation primitive

Worked example: `rotate-in`, which was added to the codebase by following exactly these steps
(the type checker flagged `primitives` and `createAnimation` after step 1).

1. **Schema** — `src/project/schema.ts`, add to `AnimationSchema`:
   ```ts
   z.strictObject({ type: z.literal('rotate-in'), anchor: inAnchor, ...timing, from: z.number().min(-720).max(720).default(-90) }),
   ```
2. **Engine** — `src/engine/animation.ts`, add to `primitives` (the compiler errors until you do):
   ```ts
   'rotate-in': (a, s, c) => { s.rotation += a.from * (1 - oneShotProgress(a, c)); },
   ```
3. **Editor defaults** — `src/project/edit.ts` → `createAnimation` (also enforced by the type
   checker), and optionally a field for `from` in `AnimationEditor`
   (`src/editor/components/Inspector.tsx`).
4. **Tests** — add a case to `tests/animation.test.ts`.
5. **Docs** — add a row to `docs/PROJECT_FORMAT.md`, run `npm run schema`.

No other code changes: the renderer, validation, AI layer, storage and editor list pick it up.

## Add an element type

1. Schema: a new `z.strictObject({...base, type: z.literal('my-type'), …})` in
   `ElementSchema`.
2. Drawing: a `Drawer` in `src/engine/draw.ts` → `drawers`. It draws centred on (0, 0) in
   project pixels and returns its local box (used for selection in the editor).
3. Editor: a default in `createElement` (`src/project/edit.ts`), a label in `ELEMENT_LABELS`
   and a `case` in `TypeSpecific` (`Inspector.tsx`).
4. If it references an asset, name the field `assetId` — validation, missing-asset checks,
   bundling and asset removal already handle `assetId`.

## Add a scene kind (for planners)

Scene kinds are what planners (AI or heuristic) may request; they compile to ordinary scenes.

1. Add the name to `SCENE_KINDS` in `src/storyboard/schema.ts` (this also updates the JSON
   schema sent to LLMs).
2. Add a `Compiler` to `sceneCompilers` in `src/storyboard/scene-kinds.ts` and a label.
3. Describe it in `PLANNER_SYSTEM_PROMPT` (`src/ai/prompt.ts`) so LLMs know when to use it.
4. Optionally teach the heuristic planner a cue in `chooseSceneKinds` (`src/ai/heuristic.ts`).

## Add an AI planner provider

Implement `PlannerProvider` (`src/ai/types.ts`):

```ts
export const myProvider: PlannerProvider = {
  id: 'my-provider',
  label: 'My model',
  isConfigured: () => Boolean(process.env.MY_KEY),
  async plan(request, signal) {
    const json = await callMyModel(PLANNER_SYSTEM_PROMPT, plannerUserMessage(request), signal);
    return { storyboard: json, model: 'my-model-1' };   // untrusted; validated by the caller
  },
};
```

Register it in `createProviders` (`src/ai/registry.ts`). You never need to validate or
compile output yourself: `generateProject` validates against `StoryboardSchema`, falls back
to the built-in planner on any error, and reports why.

## Add a template

Append to `TEMPLATES` in `src/storyboard/templates.ts`: an id, label, description, the
scene-kind skeleton and an example brief.

## Replace storage or rendering

- `ProjectStore` (`src/server/storage.ts`) is the only code touching project files; a
  database-backed store can implement the same methods.
- `RenderQueue` (`src/server/jobs.ts`) accepts any function with the `renderVideo`
  signature, so a remote/cloud renderer can be plugged in without touching the API.
