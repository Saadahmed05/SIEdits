/**
 * Storyboard: the small, strictly validated plan that planners (AI or heuristic) produce.
 * It contains only copy, enumerated choices and bounded numbers — never layout code.
 */
import { z } from 'zod';
import { FONT_FAMILIES, HexColor, TRANSITION_TYPES } from '../project/schema';

export const MOODS = ['dark-cinematic', 'bright-clean', 'bold-vibrant', 'minimal-mono', 'warm-elegant'] as const;
export type Mood = (typeof MOODS)[number];

export const SCENE_KINDS = [
  'title',
  'kinetic-text',
  'product-reveal',
  'feature-list',
  'stat',
  'logo-reveal',
  'call-to-action',
] as const;
export type SceneKind = (typeof SCENE_KINDS)[number];

export const STORYBOARD_LIMITS = {
  maxScenes: 12,
  minSceneDuration: 1,
  maxSceneDuration: 30,
  maxItems: 5,
} as const;

export const StoryboardSceneSchema = z.strictObject({
  kind: z.enum(SCENE_KINDS),
  duration: z.number().min(STORYBOARD_LIMITS.minSceneDuration).max(STORYBOARD_LIMITS.maxSceneDuration),
  headline: z.string().trim().min(1).max(120),
  subheadline: z.string().trim().max(200).default(''),
  items: z.array(z.string().trim().min(1).max(80)).max(STORYBOARD_LIMITS.maxItems).default([]),
  transition: z.enum(TRANSITION_TYPES).default('fade'),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const PaletteSchema = z.strictObject({
  primary: HexColor.optional(),
  secondary: HexColor.optional(),
  accent: HexColor.optional(),
  background: HexColor.optional(),
  text: HexColor.optional(),
});

export const StoryboardSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  productName: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(160).default(''),
  mood: z.enum(MOODS),
  palette: PaletteSchema.default({}),
  headingFont: z.enum(FONT_FAMILIES).optional(),
  scenes: z.array(StoryboardSceneSchema).min(1).max(STORYBOARD_LIMITS.maxScenes),
  /** Parts of the brief the planner could not express with supported scene kinds. */
  unsupported: z.array(z.string().trim().max(200)).max(20).default([]),
});
export type Storyboard = z.infer<typeof StoryboardSchema>;

/**
 * JSON Schema handed to LLM providers for structured output. It mirrors StoryboardSchema but
 * omits numeric/length bounds (not supported by every structured-output implementation);
 * those bounds are enforced afterwards by StoryboardSchema.
 */
export const STORYBOARD_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'productName', 'tagline', 'mood', 'palette', 'scenes', 'unsupported'],
  properties: {
    title: { type: 'string', description: 'Project title, max 120 characters' },
    productName: { type: 'string', description: 'Product or brand name, max 60 characters' },
    tagline: { type: 'string', description: 'Short tagline, max 160 characters (may be empty)' },
    mood: { type: 'string', enum: [...MOODS] },
    palette: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: Object.fromEntries(
        ['primary', 'secondary', 'accent', 'background', 'text'].map((k) => [
          k,
          { type: 'string', description: 'Hex color #rrggbb; omit to use the mood default' },
        ]),
      ),
    },
    headingFont: { type: 'string', enum: [...FONT_FAMILIES] },
    scenes: {
      type: 'array',
      description: `1 to ${STORYBOARD_LIMITS.maxScenes} scenes`,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'duration', 'headline', 'subheadline', 'items', 'transition'],
        properties: {
          kind: { type: 'string', enum: [...SCENE_KINDS] },
          duration: { type: 'number', description: `Seconds, ${STORYBOARD_LIMITS.minSceneDuration} to ${STORYBOARD_LIMITS.maxSceneDuration}` },
          headline: { type: 'string', description: 'Main on-screen text, max 120 characters' },
          subheadline: { type: 'string', description: 'Secondary text, max 200 characters (may be empty)' },
          items: { type: 'array', items: { type: 'string' }, description: `Up to ${STORYBOARD_LIMITS.maxItems} short items, max 80 characters each` },
          transition: { type: 'string', enum: [...TRANSITION_TYPES], description: 'Transition into this scene' },
        },
      },
    },
    unsupported: {
      type: 'array',
      items: { type: 'string' },
      description: 'Requests from the brief that the supported scene kinds cannot express',
    },
  },
} as const;
