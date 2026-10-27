/**
 * Scene-kind compilers: deterministic layouts and choreography for each storyboard scene kind.
 *
 * To add a scene kind: add its name to SCENE_KINDS in schema.ts and a compiler here. A compiler
 * receives the storyboard scene and returns plain element data (project schema input). All
 * colors reference brand tokens so brand edits propagate.
 */
import type { z } from 'zod';
import type { BackgroundSchema, ElementSchema, SceneSchema } from '../project/schema';
import type { MoodStyle } from './moods';
import type { SceneKind, StoryboardScene } from './schema';

type ElementInput = z.input<typeof ElementSchema>;
type SceneInput = z.input<typeof SceneSchema>;
type BackgroundInput = z.input<typeof BackgroundSchema>;

export interface CompileContext {
  style: MoodStyle;
  productName: string;
  tagline: string;
  portrait: boolean;
  /** Frame width / height, for shapes that must stay round. */
  aspect: number;
  /** Unique id generator for elements within the project. */
  nextId: (prefix: string) => string;
}

type Compiler = (scene: StoryboardScene, ctx: CompileContext) => { elements: ElementInput[]; background?: BackgroundInput };

const glow = (ctx: CompileContext, strength = 0.55) => (ctx.style.glow ? { color: '@primary', strength } : null);

function particles(ctx: CompileContext, seed: number): ElementInput[] {
  if (!ctx.style.particles) return [];
  return [
    {
      id: ctx.nextId('particles'),
      name: 'Particles',
      type: 'particles',
      count: 70,
      color: '@accent',
      size: 0.0025,
      speed: 0.015,
      seed,
      opacity: 0.6,
      animations: [{ type: 'fade-in', duration: 1.2, easing: 'linear' }],
    },
  ];
}

/** Standard exit for foreground elements so scenes hand over cleanly to the next transition. */
const exit = (duration = 0.35) => ({ type: 'fade-out' as const, duration, easing: 'ease-in' as const });

const title: Compiler = (s, ctx) => {
  const headSize = ctx.portrait ? 0.055 : 0.1;
  const elements: ElementInput[] = [
    ...particles(ctx, 7),
    {
      id: ctx.nextId('headline'),
      name: 'Headline',
      type: 'text',
      text: s.headline,
      size: headSize,
      weight: 800,
      y: s.subheadline ? 0.45 : 0.5,
      maxWidth: ctx.portrait ? 0.86 : 0.8,
      glow: glow(ctx),
      letterSpacing: -0.01,
      animations: [
        { type: 'fade-in', duration: 0.8, delay: 0.15 },
        { type: 'tracking-in', duration: 1.2, delay: 0.15, from: 0.35, easing: 'ease-out-expo' },
        { type: 'scale-in', duration: 1.2, delay: 0.15, from: 0.92, easing: 'ease-out-expo' },
        exit(),
      ],
    },
    {
      id: ctx.nextId('rule'),
      name: 'Accent line',
      type: 'shape',
      shape: 'rect',
      width: ctx.portrait ? 0.2 : 0.08,
      height: 0.006,
      y: s.subheadline ? 0.545 : 0.58,
      fill: '@primary',
      cornerRadius: 0.003,
      glow: glow(ctx, 0.8),
      animations: [
        { type: 'scale-in', from: 0, duration: 0.7, delay: 0.6, easing: 'ease-out-expo' },
        exit(),
      ],
    },
  ];
  if (s.subheadline) {
    elements.push({
      id: ctx.nextId('subheadline'),
      name: 'Subheadline',
      type: 'text',
      text: s.subheadline,
      font: '@body',
      weight: 500,
      size: ctx.portrait ? 0.026 : 0.038,
      color: '@text',
      opacity: 0.78,
      y: 0.61,
      maxWidth: 0.7,
      animations: [
        { type: 'fade-in', duration: 0.7, delay: 0.75 },
        { type: 'slide-in', direction: 'up', distance: 0.03, duration: 0.8, delay: 0.75 },
        exit(),
      ],
    });
  }
  return { elements };
};

const kineticText: Compiler = (s, ctx) => {
  const phrases = s.items.length ? s.items : chunkWords(s.headline, 3);
  const slice = s.subheadline ? 0.82 / phrases.length : 1 / phrases.length;
  const elements: ElementInput[] = [];
  phrases.forEach((phrase, i) => {
    const start = +(i * slice * s.duration).toFixed(3);
    const last = i === phrases.length - 1;
    const end = last ? null : +((i + 1) * slice * s.duration).toFixed(3);
    elements.push({
      id: ctx.nextId('phrase'),
      name: `Phrase ${i + 1}`,
      type: 'text',
      text: phrase,
      uppercase: true,
      weight: 800,
      size: ctx.portrait ? 0.07 : 0.13,
      letterSpacing: 0.02,
      color: i % 2 === 1 ? '@primary' : '@text',
      glow: i % 2 === 1 ? glow(ctx, 0.7) : null,
      start,
      end,
      animations: [
        { type: 'scale-in', from: 1.35, duration: 0.45, easing: 'ease-out-expo' },
        { type: 'fade-in', duration: 0.2, easing: 'linear' },
        ...(last ? [exit()] : [{ type: 'fade-out' as const, duration: 0.15, easing: 'linear' as const }]),
      ],
    });
  });
  if (s.subheadline) {
    elements.push({
      id: ctx.nextId('caption'),
      name: 'Caption',
      type: 'text',
      text: s.subheadline,
      font: '@body',
      weight: 500,
      size: ctx.portrait ? 0.026 : 0.036,
      opacity: 0.8,
      y: 0.68,
      start: +(0.82 * s.duration * ((phrases.length - 1) / phrases.length)).toFixed(3),
      animations: [{ type: 'fade-in', duration: 0.5 }, { type: 'slide-in', direction: 'up', distance: 0.02, duration: 0.6 }, exit()],
    });
  }
  return { elements };
};

const productReveal: Compiler = (s, ctx) => {
  const elements: ElementInput[] = [];
  if (ctx.portrait) {
    elements.push(
      {
        id: ctx.nextId('headline'),
        name: 'Headline',
        type: 'text',
        text: s.headline,
        size: 0.042,
        weight: 800,
        y: 0.16,
        maxWidth: 0.86,
        animations: [{ type: 'fade-in', duration: 0.6 }, { type: 'slide-in', direction: 'up', distance: 0.03, duration: 0.7 }, exit()],
      },
      {
        id: ctx.nextId('device'),
        name: 'Product screenshot',
        type: 'device',
        frame: 'phone',
        width: 0.52,
        y: 0.6,
        animations: [
          { type: 'slide-in', direction: 'up', distance: 0.5, duration: 1.1, delay: 0.25, easing: 'ease-out-expo' },
          { type: 'fade-in', duration: 0.5, delay: 0.25 },
          { type: 'float', amplitude: 0.006, period: 4 },
          exit(),
        ],
      },
    );
    if (s.subheadline)
      elements.push({
        id: ctx.nextId('subheadline'),
        name: 'Subheadline',
        type: 'text',
        text: s.subheadline,
        font: '@body',
        weight: 500,
        size: 0.022,
        opacity: 0.78,
        y: 0.235,
        maxWidth: 0.8,
        animations: [{ type: 'fade-in', duration: 0.6, delay: 0.4 }, exit()],
      });
    return { elements };
  }
  elements.push(
    {
      id: ctx.nextId('device'),
      name: 'Product screenshot',
      type: 'device',
      frame: 'browser',
      width: 0.52,
      x: 0.66,
      y: 0.53,
      animations: [
        { type: 'slide-in', direction: 'up', distance: 0.35, duration: 1.2, delay: 0.2, easing: 'ease-out-expo' },
        { type: 'fade-in', duration: 0.5, delay: 0.2 },
        { type: 'zoom', from: 1, to: 1.04, duration: Math.max(0.5, s.duration - 1), delay: 1, easing: 'linear' },
        exit(),
      ],
    },
    {
      id: ctx.nextId('headline'),
      name: 'Headline',
      type: 'text',
      text: s.headline,
      size: 0.07,
      weight: 800,
      align: 'left',
      x: 0.07,
      y: 0.44,
      maxWidth: 0.3,
      lineHeight: 1.08,
      animations: [{ type: 'fade-in', duration: 0.6 }, { type: 'slide-in', direction: 'right', distance: 0.04, duration: 0.8 }, exit()],
    },
  );
  if (s.subheadline)
    elements.push({
      id: ctx.nextId('subheadline'),
      name: 'Subheadline',
      type: 'text',
      text: s.subheadline,
      font: '@body',
      weight: 500,
      size: 0.03,
      align: 'left',
      x: 0.07,
      y: 0.54,
      maxWidth: 0.3,
      opacity: 0.78,
      animations: [{ type: 'fade-in', duration: 0.6, delay: 0.45 }, { type: 'slide-in', direction: 'right', distance: 0.03, duration: 0.7, delay: 0.45 }, exit()],
    });
  return { elements };
};

const featureList: Compiler = (s, ctx) => {
  const items = s.items.length ? s.items : [s.subheadline || s.headline];
  const elements: ElementInput[] = [
    {
      id: ctx.nextId('headline'),
      name: 'Headline',
      type: 'text',
      text: s.headline,
      size: ctx.portrait ? 0.042 : 0.065,
      weight: 800,
      align: ctx.portrait ? 'center' : 'left',
      x: ctx.portrait ? 0.5 : 0.1,
      y: ctx.portrait ? 0.22 : 0.24,
      maxWidth: 0.8,
      animations: [{ type: 'fade-in', duration: 0.5 }, { type: 'slide-in', direction: 'up', distance: 0.03, duration: 0.7 }, exit()],
    },
  ];
  const top = ctx.portrait ? 0.36 : 0.42;
  const gap = ctx.portrait ? 0.09 : Math.min(0.12, 0.5 / items.length);
  const left = ctx.portrait ? 0.14 : 0.1;
  items.forEach((item, i) => {
    const delay = 0.45 + i * 0.3;
    const y = top + i * gap;
    elements.push(
      {
        id: ctx.nextId('bullet'),
        name: `Bullet ${i + 1}`,
        type: 'shape',
        shape: 'ellipse',
        width: ctx.portrait ? 0.022 : 0.014,
        height: ctx.portrait ? 0.012 : 0.025,
        x: left + 0.007,
        y,
        fill: '@primary',
        glow: glow(ctx, 0.8),
        animations: [{ type: 'scale-in', from: 0, duration: 0.45, delay, easing: 'ease-out-back' }, exit()],
      },
      {
        id: ctx.nextId('item'),
        name: `Item ${i + 1}`,
        type: 'text',
        text: item,
        font: '@body',
        weight: 600,
        size: ctx.portrait ? 0.028 : 0.042,
        align: 'left',
        x: left + 0.035,
        y,
        maxWidth: 0.75,
        animations: [{ type: 'fade-in', duration: 0.45, delay }, { type: 'slide-in', direction: 'right', distance: 0.03, duration: 0.6, delay }, exit()],
      },
    );
  });
  return { elements };
};

const stat: Compiler = (s, ctx) => {
  const elements: ElementInput[] = [
    ...particles(ctx, 11),
    {
      id: ctx.nextId('stat'),
      name: 'Statistic',
      type: 'text',
      text: s.headline,
      size: ctx.portrait ? 0.08 : 0.16,
      weight: 800,
      color: '@primary',
      y: 0.45,
      glow: glow(ctx, 0.8),
      animations: [
        { type: 'scale-in', from: 0.6, duration: 0.9, easing: 'ease-out-back' },
        { type: 'fade-in', duration: 0.4 },
        { type: 'pulse', amount: 0.015, period: 2.4 },
        exit(),
      ],
    },
  ];
  if (s.subheadline)
    elements.push({
      id: ctx.nextId('label'),
      name: 'Label',
      type: 'text',
      text: s.subheadline,
      font: '@body',
      weight: 500,
      size: ctx.portrait ? 0.028 : 0.042,
      opacity: 0.8,
      y: 0.6,
      animations: [{ type: 'fade-in', duration: 0.6, delay: 0.5 }, { type: 'slide-in', direction: 'up', distance: 0.02, duration: 0.6, delay: 0.5 }, exit()],
    });
  return { elements, background: ctx.style.emphasisBackground };
};

const logoReveal: Compiler = (s, ctx) => {
  const elements: ElementInput[] = [
    ...particles(ctx, 23),
    {
      id: ctx.nextId('ring'),
      name: 'Ring',
      type: 'shape',
      shape: 'ellipse',
      // Width is relative to frame width, height to frame height: divide by aspect for a circle.
      width: (ctx.portrait ? 0.16 : 0.28) / ctx.aspect,
      height: ctx.portrait ? 0.16 : 0.28,
      y: 0.45,
      fill: null,
      stroke: '@primary',
      strokeWidth: 0.003,
      glow: glow(ctx, 0.9),
      animations: [
        { type: 'scale-in', from: 0.2, duration: 1.1, easing: 'ease-out-expo' },
        { type: 'fade-in', duration: 0.3 },
        { type: 'fade-out', anchor: 'start', delay: 0.8, duration: 0.8, easing: 'ease-out' },
        { type: 'scale-out', anchor: 'start', delay: 0.8, duration: 0.8, to: 1.8, easing: 'ease-out' },
      ],
    },
    {
      id: ctx.nextId('logo'),
      name: 'Logo',
      type: 'logo',
      wordmark: s.headline,
      size: ctx.portrait ? 0.07 : 0.13,
      y: 0.45,
      glow: glow(ctx, 0.5),
      animations: [
        { type: 'scale-in', from: 0.5, duration: 0.9, delay: 0.25, easing: 'ease-out-back' },
        { type: 'fade-in', duration: 0.5, delay: 0.25 },
      ],
    },
  ];
  const tagline = s.subheadline || ctx.tagline;
  if (tagline)
    elements.push({
      id: ctx.nextId('tagline'),
      name: 'Tagline',
      type: 'text',
      text: tagline,
      font: '@body',
      weight: 500,
      size: ctx.portrait ? 0.026 : 0.036,
      opacity: 0.8,
      letterSpacing: 0.04,
      y: 0.63,
      animations: [
        { type: 'fade-in', duration: 0.8, delay: 0.9 },
        { type: 'tracking-in', from: 0.25, duration: 1.2, delay: 0.9, easing: 'ease-out-expo' },
      ],
    });
  return { elements, background: ctx.style.emphasisBackground };
};

const callToAction: Compiler = (s, ctx) => {
  const buttonText = s.subheadline || 'Get started';
  const btnW = ctx.portrait ? 0.56 : Math.min(0.42, 0.1 + buttonText.length * 0.012);
  const elements: ElementInput[] = [
    {
      id: ctx.nextId('headline'),
      name: 'Headline',
      type: 'text',
      text: s.headline,
      size: ctx.portrait ? 0.05 : 0.085,
      weight: 800,
      y: 0.38,
      glow: glow(ctx, 0.5),
      animations: [{ type: 'fade-in', duration: 0.6 }, { type: 'scale-in', from: 0.9, duration: 0.8, easing: 'ease-out-expo' }],
    },
    {
      id: ctx.nextId('button'),
      name: 'Button',
      type: 'shape',
      shape: 'rect',
      width: btnW,
      height: ctx.portrait ? 0.06 : 0.1,
      y: 0.58,
      fill: '@primary',
      cornerRadius: ctx.portrait ? 0.03 : 0.05,
      glow: glow(ctx, 0.7),
      animations: [
        { type: 'scale-in', from: 0.6, duration: 0.6, delay: 0.4, easing: 'ease-out-back' },
        { type: 'fade-in', duration: 0.3, delay: 0.4 },
        { type: 'pulse', amount: 0.025, period: 1.6 },
      ],
    },
    {
      id: ctx.nextId('button-label'),
      name: 'Button label',
      type: 'text',
      text: buttonText,
      font: '@body',
      weight: 700,
      size: ctx.portrait ? 0.024 : 0.036,
      color: '@background',
      y: 0.58,
      animations: [
        { type: 'fade-in', duration: 0.4, delay: 0.6 },
        { type: 'pulse', amount: 0.025, period: 1.6 },
      ],
    },
  ];
  if (s.items[0])
    elements.push({
      id: ctx.nextId('url'),
      name: 'URL',
      type: 'text',
      text: s.items[0],
      font: '@body',
      weight: 500,
      size: ctx.portrait ? 0.022 : 0.03,
      opacity: 0.7,
      y: 0.74,
      animations: [{ type: 'fade-in', duration: 0.6, delay: 0.9 }],
    });
  return { elements, background: ctx.style.emphasisBackground };
};

export const sceneCompilers: Record<SceneKind, Compiler> = {
  title,
  'kinetic-text': kineticText,
  'product-reveal': productReveal,
  'feature-list': featureList,
  stat,
  'logo-reveal': logoReveal,
  'call-to-action': callToAction,
};

export const SCENE_KIND_LABELS: Record<SceneKind, string> = {
  title: 'Title',
  'kinetic-text': 'Kinetic text',
  'product-reveal': 'Product reveal',
  'feature-list': 'Feature list',
  stat: 'Statistic',
  'logo-reveal': 'Logo reveal',
  'call-to-action': 'Call to action',
};

export function chunkWords(text: string, size: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += size) chunks.push(words.slice(i, i + size).join(' '));
  return chunks.length ? chunks.slice(0, 6) : [text];
}

export function compileScene(
  kind: SceneKind,
  scene: StoryboardScene,
  ctx: CompileContext,
  id: string,
  name: string,
  transitionDuration: number,
): SceneInput {
  const { elements, background } = sceneCompilers[kind](scene, ctx);
  return {
    id,
    name,
    duration: scene.duration,
    background: background ?? ctx.style.background,
    transition: { type: scene.transition, duration: scene.transition === 'none' ? 0 : transitionDuration },
    elements,
    notes: `${SCENE_KIND_LABELS[kind]} scene`,
  };
}
