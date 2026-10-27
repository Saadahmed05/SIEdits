/**
 * SceneWright project format, version 1.
 *
 * This schema is the single source of truth for what a project may contain. Everything that
 * enters the system (files on disk, imports, editor saves, AI output after compilation) is
 * parsed with it. Objects are strict: unknown keys are rejected, so nothing that is not
 * explicitly supported can reach the renderer.
 *
 * Human-readable specification: docs/PROJECT_FORMAT.md
 */
import { z } from 'zod';

export const PROJECT_FORMAT = 'scenewright.project';
export const PROJECT_VERSION = 1;

export const LIMITS = {
  maxWidth: 3840,
  maxHeight: 3840,
  minDimension: 16,
  maxFps: 60,
  maxScenes: 50,
  maxElementsPerScene: 40,
  maxAnimationsPerElement: 8,
  maxSceneDuration: 120,
  maxTotalDuration: 600,
  maxTextLength: 500,
  maxAssets: 100,
} as const;

const id = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/, 'ids may contain letters, digits, "_" and "-" (max 64)');

const shortText = (max: number) => z.string().max(max);

/** Brand tokens that colors may reference instead of literal hex values. */
export const BRAND_TOKENS = ['primary', 'secondary', 'accent', 'background', 'text'] as const;
export type BrandToken = (typeof BRAND_TOKENS)[number];

const HEX = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const HexColor = z.string().regex(HEX, 'expected a hex color like #1a2b3c or #1a2b3cff');
export const Color = z
  .string()
  .refine(
    (v) => HEX.test(v) || BRAND_TOKENS.some((t) => v === `@${t}`),
    'expected a hex color (#rrggbb / #rrggbbaa) or a brand token (@primary, @secondary, @accent, @background, @text)',
  );

/** Bundled font families (OFL-1.1, see docs/LICENSES.md). Restricting to bundled fonts keeps renders reproducible. */
export const FONT_FAMILIES = ['Inter', 'Space Grotesk', 'Playfair Display'] as const;
export const FontRef = z.union([z.enum(FONT_FAMILIES), z.literal('@heading'), z.literal('@body')]);
export const FontWeight = z.union([
  z.literal(400),
  z.literal(500),
  z.literal(600),
  z.literal(700),
  z.literal(800),
]);

export const EASINGS = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-out-back',
  'ease-out-expo',
  'ease-in-out-expo',
] as const;
export const Easing = z.enum(EASINGS);

const unit = z.number().min(0).max(1);
/** Positions may go slightly outside the frame so elements can enter from off-screen. */
const position = z.number().min(-1).max(2);
const seconds = z.number().min(0).max(LIMITS.maxSceneDuration);
const Direction = z.enum(['left', 'right', 'up', 'down']);

// ---------------------------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------------------------

/**
 * Timing shared by all one-shot animations.
 * - anchor "start": the animation begins `delay` seconds after the element appears.
 * - anchor "end":   the animation finishes `delay` seconds before the element disappears.
 */
const timing = {
  delay: seconds.default(0),
  duration: z.number().min(0.01).max(LIMITS.maxSceneDuration),
  easing: Easing.default('ease-out'),
};
const inAnchor = z.enum(['start', 'end']).default('start');
const outAnchor = z.enum(['start', 'end']).default('end');

export const AnimationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('fade-in'), anchor: inAnchor, ...timing }),
  z.strictObject({ type: z.literal('fade-out'), anchor: outAnchor, ...timing }),
  z.strictObject({
    type: z.literal('slide-in'),
    anchor: inAnchor,
    ...timing,
    /** Direction the element moves towards; it starts `distance` away on the opposite side. */
    direction: Direction.default('up'),
    distance: z.number().min(0).max(2).default(0.1),
  }),
  z.strictObject({
    type: z.literal('slide-out'),
    anchor: outAnchor,
    ...timing,
    direction: Direction.default('up'),
    distance: z.number().min(0).max(2).default(0.1),
  }),
  z.strictObject({
    type: z.literal('scale-in'),
    anchor: inAnchor,
    ...timing,
    from: z.number().min(0).max(10).default(0.6),
  }),
  z.strictObject({
    type: z.literal('scale-out'),
    anchor: outAnchor,
    ...timing,
    to: z.number().min(0).max(10).default(0.6),
  }),
  /** Zoom between two scales over the duration (Ken Burns style). */
  z.strictObject({
    type: z.literal('zoom'),
    anchor: inAnchor,
    ...timing,
    from: z.number().min(0).max(10).default(1),
    to: z.number().min(0).max(10).default(1.1),
  }),
  /** Rotate from `from` degrees to the element's own rotation. */
  z.strictObject({
    type: z.literal('rotate-in'),
    anchor: inAnchor,
    ...timing,
    from: z.number().min(-720).max(720).default(-90),
  }),
  /** Text only: reveal characters progressively. */
  z.strictObject({ type: z.literal('typewriter'), anchor: inAnchor, ...timing }),
  /** Text only: letter spacing collapses from `from` (em) to the element's own spacing. */
  z.strictObject({
    type: z.literal('tracking-in'),
    anchor: inAnchor,
    ...timing,
    from: z.number().min(0).max(2).default(0.5),
  }),
  /** Continuous vertical bob (sine). Does not end. */
  z.strictObject({
    type: z.literal('float'),
    amplitude: z.number().min(0).max(0.5).default(0.01),
    period: z.number().min(0.1).max(60).default(3),
  }),
  /** Continuous scale pulse (sine). */
  z.strictObject({
    type: z.literal('pulse'),
    amount: z.number().min(0).max(1).default(0.04),
    period: z.number().min(0.1).max(60).default(1.6),
  }),
  /** Continuous rotation in degrees per second. */
  z.strictObject({ type: z.literal('spin'), speed: z.number().min(-3600).max(3600).default(30) }),
]);
export type Animation = z.infer<typeof AnimationSchema>;
export type AnimationType = Animation['type'];
export const ANIMATION_TYPES = AnimationSchema.options.map((o) => o.shape.type.value) as AnimationType[];

// ---------------------------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------------------------

/** Fields every element shares. x/y is the anchor point as a fraction of frame width/height. */
const base = {
  id,
  name: shortText(80).optional(),
  x: position.default(0.5),
  y: position.default(0.5),
  rotation: z.number().min(-3600).max(3600).default(0),
  scale: z.number().min(0).max(10).default(1),
  opacity: unit.default(1),
  /** Seconds after scene start when the element appears. */
  start: seconds.default(0),
  /** Seconds after scene start when the element disappears; null = end of scene. */
  end: seconds.nullable().default(null),
  animations: z.array(AnimationSchema).max(LIMITS.maxAnimationsPerElement).default([]),
};

export const Glow = z.strictObject({ color: Color, strength: unit.default(0.6) });

export const TextElementSchema = z.strictObject({
  ...base,
  type: z.literal('text'),
  text: z.string().min(1).max(LIMITS.maxTextLength),
  font: FontRef.default('@heading'),
  weight: FontWeight.default(700),
  /** Font size as a fraction of frame height. */
  size: z.number().min(0.005).max(0.5).default(0.08),
  color: Color.default('@text'),
  /** Horizontal anchor: x is the left edge, center or right edge of the text block. */
  align: z.enum(['left', 'center', 'right']).default('center'),
  /** Extra spacing between letters in em. */
  letterSpacing: z.number().min(-0.2).max(2).default(0),
  lineHeight: z.number().min(0.6).max(3).default(1.15),
  /** Wrap width as a fraction of frame width. */
  maxWidth: z.number().min(0.05).max(1).default(0.85),
  uppercase: z.boolean().default(false),
  glow: Glow.nullable().default(null),
});

export const ShapeElementSchema = z.strictObject({
  ...base,
  type: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse']),
  /** Width as a fraction of frame width. */
  width: z.number().min(0).max(3),
  /** Height as a fraction of frame height. */
  height: z.number().min(0).max(3),
  fill: Color.nullable().default('@primary'),
  stroke: Color.nullable().default(null),
  /** Stroke width as a fraction of frame height. */
  strokeWidth: z.number().min(0).max(0.1).default(0.004),
  /** Corner radius as a fraction of frame height (rect only). */
  cornerRadius: z.number().min(0).max(1).default(0),
  glow: Glow.nullable().default(null),
});

export const ImageElementSchema = z.strictObject({
  ...base,
  type: z.literal('image'),
  assetId: id,
  /** Width as a fraction of frame width; height follows the image aspect ratio. */
  width: z.number().min(0.01).max(3).default(0.5),
  cornerRadius: z.number().min(0).max(1).default(0),
  shadow: z.boolean().default(false),
});

export const LogoElementSchema = z.strictObject({
  ...base,
  type: z.literal('logo'),
  /** Uploaded logo image. When null, a generated monogram mark + wordmark is drawn. */
  assetId: id.nullable().default(null),
  wordmark: shortText(60).default(''),
  /** Mark height as a fraction of frame height. */
  size: z.number().min(0.01).max(1).default(0.14),
  color: Color.default('@text'),
  markColor: Color.default('@primary'),
  font: FontRef.default('@heading'),
  glow: Glow.nullable().default(null),
});

/** A product screenshot shown in a device frame. Draws a neutral placeholder UI if no asset is set. */
export const DeviceElementSchema = z.strictObject({
  ...base,
  type: z.literal('device'),
  frame: z.enum(['browser', 'phone', 'none']).default('browser'),
  assetId: id.nullable().default(null),
  /** Width as a fraction of frame width. */
  width: z.number().min(0.05).max(2).default(0.6),
  accent: Color.default('@primary'),
  shadow: z.boolean().default(true),
});

/** Deterministic drifting particles (seeded), e.g. for cinematic backgrounds. */
export const ParticlesElementSchema = z.strictObject({
  ...base,
  type: z.literal('particles'),
  count: z.number().int().min(1).max(400).default(60),
  color: Color.default('@accent'),
  /** Particle radius as a fraction of frame height. */
  size: z.number().min(0.0005).max(0.05).default(0.003),
  /** Drift speed in frame-heights per second. */
  speed: z.number().min(0).max(2).default(0.02),
  seed: z.number().int().min(0).max(2 ** 31 - 1).default(1),
});

export const ElementSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ShapeElementSchema,
  ImageElementSchema,
  LogoElementSchema,
  DeviceElementSchema,
  ParticlesElementSchema,
]);
export type Element = z.infer<typeof ElementSchema>;
export type ElementType = Element['type'];
export type TextElement = z.infer<typeof TextElementSchema>;
export type ShapeElement = z.infer<typeof ShapeElementSchema>;
export type ImageElement = z.infer<typeof ImageElementSchema>;
export type LogoElement = z.infer<typeof LogoElementSchema>;
export type DeviceElement = z.infer<typeof DeviceElementSchema>;
export type ParticlesElement = z.infer<typeof ParticlesElementSchema>;
export const ELEMENT_TYPES = ElementSchema.options.map((o) => o.shape.type.value) as ElementType[];

// ---------------------------------------------------------------------------------------------
// Backgrounds, transitions, scenes
// ---------------------------------------------------------------------------------------------

const GradientStop = z.strictObject({ offset: unit, color: Color });

export const BackgroundSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('solid'), color: Color }),
  z.strictObject({
    type: z.literal('linear-gradient'),
    angle: z.number().min(-360).max(360).default(135),
    stops: z.array(GradientStop).min(2).max(6),
    /** Degrees per second the gradient rotates; 0 = static. */
    rotateSpeed: z.number().min(-360).max(360).default(0),
    vignette: unit.default(0),
  }),
  z.strictObject({
    type: z.literal('radial-gradient'),
    cx: unit.default(0.5),
    cy: unit.default(0.5),
    stops: z.array(GradientStop).min(2).max(6),
    vignette: unit.default(0),
  }),
]);
export type Background = z.infer<typeof BackgroundSchema>;

export const TRANSITION_TYPES = ['none', 'fade', 'slide-left', 'slide-up', 'zoom', 'wipe'] as const;
export const TransitionSchema = z.strictObject({
  type: z.enum(TRANSITION_TYPES).default('fade'),
  /** Seconds this scene overlaps the end of the previous one. Ignored for the first scene. */
  duration: z.number().min(0).max(5).default(0.5),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const SceneSchema = z.strictObject({
  id,
  name: shortText(80).default('Scene'),
  duration: z.number().min(0.1).max(LIMITS.maxSceneDuration),
  background: BackgroundSchema,
  transition: TransitionSchema.default({ type: 'none', duration: 0 }),
  elements: z.array(ElementSchema).max(LIMITS.maxElementsPerScene).default([]),
  /** Free-form note shown in the editor (e.g. the planner's intent for this scene). */
  notes: shortText(500).optional(),
});
export type Scene = z.infer<typeof SceneSchema>;

// ---------------------------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------------------------

export const BrandSchema = z.strictObject({
  primary: HexColor,
  secondary: HexColor,
  accent: HexColor,
  background: HexColor,
  text: HexColor,
  headingFont: z.enum(FONT_FAMILIES).default('Inter'),
  bodyFont: z.enum(FONT_FAMILIES).default('Inter'),
});
export type Brand = z.infer<typeof BrandSchema>;

export const AssetSchema = z.strictObject({
  id,
  kind: z.literal('image'),
  name: shortText(200),
  /** File name inside the project's assets/ directory. No paths. */
  file: z.string().regex(/^[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp)$/, 'asset file must be a plain file name'),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const SettingsSchema = z.strictObject({
  width: z.number().int().min(LIMITS.minDimension).max(LIMITS.maxWidth),
  height: z.number().int().min(LIMITS.minDimension).max(LIMITS.maxHeight),
  fps: z.number().int().min(1).max(LIMITS.maxFps),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const GenerationInfoSchema = z.strictObject({
  brief: shortText(4000),
  template: shortText(64),
  planner: shortText(64),
  model: shortText(128).optional(),
  at: z.iso.datetime(),
  warnings: z.array(shortText(500)).max(50).default([]),
  unsupported: z.array(shortText(300)).max(50).default([]),
});

export const RenderConfigSchema = z.strictObject({
  /** x264 constant rate factor; lower is higher quality. */
  crf: z.number().int().min(0).max(51).default(18),
  preset: z.enum(['ultrafast', 'veryfast', 'fast', 'medium', 'slow']).default('veryfast'),
});

const ProjectObject = z.strictObject({
  format: z.literal(PROJECT_FORMAT),
  version: z.literal(PROJECT_VERSION),
  id,
  name: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  settings: SettingsSchema,
  brand: BrandSchema,
  assets: z.array(AssetSchema).max(LIMITS.maxAssets).default([]),
  scenes: z.array(SceneSchema).min(1).max(LIMITS.maxScenes),
  render: RenderConfigSchema.default({ crf: 18, preset: 'veryfast' }),
  generation: GenerationInfoSchema.optional(),
});

/** Cross-field rules that a per-field schema cannot express. */
export const ProjectSchema = ProjectObject.superRefine((p, ctx) => {
  const assetIds = new Set<string>();
  p.assets.forEach((a, i) => {
    if (assetIds.has(a.id)) ctx.addIssue({ code: 'custom', path: ['assets', i, 'id'], message: `duplicate asset id "${a.id}"` });
    assetIds.add(a.id);
  });

  const sceneIds = new Set<string>();
  let total = 0;
  p.scenes.forEach((scene, si) => {
    const path = ['scenes', si];
    if (sceneIds.has(scene.id)) ctx.addIssue({ code: 'custom', path: [...path, 'id'], message: `duplicate scene id "${scene.id}"` });
    sceneIds.add(scene.id);

    const overlap = si === 0 ? 0 : effectiveTransitionDuration(scene);
    if (si > 0) {
      const prev = p.scenes[si - 1]!;
      if (overlap > Math.min(scene.duration, prev.duration)) {
        ctx.addIssue({
          code: 'custom',
          path: [...path, 'transition', 'duration'],
          message: `transition (${overlap}s) must not be longer than this scene (${scene.duration}s) or the previous scene (${prev.duration}s)`,
        });
      }
    }
    const next = p.scenes[si + 1];
    const nextOverlap = next ? effectiveTransitionDuration(next) : 0;
    if (si > 0 && overlap + nextOverlap > scene.duration + 1e-9) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, 'duration'],
        message: `scene is too short (${scene.duration}s) for its incoming and outgoing transitions (${overlap + nextOverlap}s)`,
      });
    }
    total += scene.duration - overlap;

    const elementIds = new Set<string>();
    scene.elements.forEach((el, ei) => {
      const epath = [...path, 'elements', ei];
      if (elementIds.has(el.id)) ctx.addIssue({ code: 'custom', path: [...epath, 'id'], message: `duplicate element id "${el.id}"` });
      elementIds.add(el.id);
      if (el.end !== null && el.end <= el.start) {
        ctx.addIssue({ code: 'custom', path: [...epath, 'end'], message: 'end must be after start' });
      }
      if (el.start >= scene.duration) {
        ctx.addIssue({ code: 'custom', path: [...epath, 'start'], message: `starts after the scene ends (${scene.duration}s)` });
      }
      const assetId = 'assetId' in el ? el.assetId : null;
      if (assetId && !assetIds.has(assetId)) {
        ctx.addIssue({ code: 'custom', path: [...epath, 'assetId'], message: `unknown asset "${assetId}"` });
      }
      el.animations.forEach((a, ai) => {
        if ((a.type === 'typewriter' || a.type === 'tracking-in') && el.type !== 'text') {
          ctx.addIssue({ code: 'custom', path: [...epath, 'animations', ai, 'type'], message: `"${a.type}" only applies to text elements` });
        }
      });
    });
  });

  if (total > LIMITS.maxTotalDuration) {
    ctx.addIssue({ code: 'custom', path: ['scenes'], message: `total duration ${total.toFixed(2)}s exceeds ${LIMITS.maxTotalDuration}s` });
  }
});

export type Project = z.infer<typeof ProjectSchema>;
/** Input type (defaults not yet applied) — what may be written in a project file. */
export type ProjectInput = z.input<typeof ProjectSchema>;

export function effectiveTransitionDuration(scene: Pick<Scene, 'transition'>): number {
  return scene.transition.type === 'none' ? 0 : scene.transition.duration;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: ValidationIssue[] };

export function formatPath(path: ReadonlyArray<PropertyKey>): string {
  return path.reduce<string>((acc, part) => {
    if (typeof part === 'number') return `${acc}[${part}]`;
    return acc ? `${acc}.${String(part)}` : String(part);
  }, '');
}

export function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: formatPath(i.path) || '(root)', message: i.message }));
}

/** Validate an unknown value (e.g. parsed JSON) as a v1 project. Does not migrate. */
export function parseProject(input: unknown): ParseResult<Project> {
  const result = ProjectSchema.safeParse(input);
  return result.success ? { ok: true, value: result.data } : { ok: false, issues: toIssues(result.error) };
}
