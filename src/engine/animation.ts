/**
 * Animation primitives. Each primitive is a pure function of time that modifies an element's
 * render state. To add a primitive: add it to AnimationSchema in project/schema.ts, then add
 * an entry to `primitives` below (TypeScript enforces that every schema type is handled).
 */
import type { Animation, AnimationType, Element } from '../project/schema';
import { ease } from './easing';

export interface ElementState {
  /** Offset from the element's base position, in fractions of frame width / height. */
  dx: number;
  dy: number;
  scale: number;
  opacity: number;
  rotation: number;
  /** Fraction of characters revealed (text). */
  reveal: number;
  /** Extra letter spacing in em (text). */
  tracking: number;
}

export interface AnimationContext {
  /** Seconds since the element appeared. */
  time: number;
  /** How long the element is visible in seconds. */
  lifetime: number;
}

type Of<T extends AnimationType> = Extract<Animation, { type: T }>;
type Primitive<T extends AnimationType> = (anim: Of<T>, state: ElementState, ctx: AnimationContext) => void;

/**
 * Progress in [0, 1] of a one-shot animation, already eased.
 * anchor "start": begins `delay` after the element appears.
 * anchor "end":   finishes `delay` before the element disappears.
 */
export function oneShotProgress(
  anim: { anchor: 'start' | 'end'; delay: number; duration: number; easing: Parameters<typeof ease>[0] },
  ctx: AnimationContext,
): number {
  const begin = anim.anchor === 'start' ? anim.delay : ctx.lifetime - anim.delay - anim.duration;
  const raw = (ctx.time - begin) / anim.duration;
  return ease(anim.easing, raw);
}

function slideVector(direction: 'left' | 'right' | 'up' | 'down'): [number, number] {
  switch (direction) {
    case 'left':
      return [-1, 0];
    case 'right':
      return [1, 0];
    case 'up':
      return [0, -1];
    case 'down':
      return [0, 1];
  }
}

const primitives: { [T in AnimationType]: Primitive<T> } = {
  'fade-in': (a, s, c) => {
    s.opacity *= oneShotProgress(a, c);
  },
  'fade-out': (a, s, c) => {
    s.opacity *= 1 - oneShotProgress(a, c);
  },
  'slide-in': (a, s, c) => {
    // Moves *towards* `direction`, ending at the base position.
    const p = oneShotProgress(a, c);
    const [vx, vy] = slideVector(a.direction);
    s.dx -= vx * a.distance * (1 - p);
    s.dy -= vy * a.distance * (1 - p);
  },
  'slide-out': (a, s, c) => {
    const p = oneShotProgress(a, c);
    const [vx, vy] = slideVector(a.direction);
    s.dx += vx * a.distance * p;
    s.dy += vy * a.distance * p;
  },
  'scale-in': (a, s, c) => {
    const p = oneShotProgress(a, c);
    s.scale *= a.from + (1 - a.from) * p;
  },
  'scale-out': (a, s, c) => {
    const p = oneShotProgress(a, c);
    s.scale *= 1 + (a.to - 1) * p;
  },
  zoom: (a, s, c) => {
    const p = oneShotProgress(a, c);
    s.scale *= a.from + (a.to - a.from) * p;
  },
  'rotate-in': (a, s, c) => {
    s.rotation += a.from * (1 - oneShotProgress(a, c));
  },
  typewriter: (a, s, c) => {
    s.reveal = Math.min(s.reveal, oneShotProgress(a, c));
  },
  'tracking-in': (a, s, c) => {
    s.tracking += a.from * (1 - oneShotProgress(a, c));
  },
  float: (a, s, c) => {
    s.dy += Math.sin((c.time / a.period) * Math.PI * 2) * a.amplitude;
  },
  pulse: (a, s, c) => {
    s.scale *= 1 + Math.sin((c.time / a.period) * Math.PI * 2) * a.amount;
  },
  spin: (a, s, c) => {
    s.rotation += a.speed * c.time;
  },
};

export function applyAnimation(anim: Animation, state: ElementState, ctx: AnimationContext): void {
  (primitives[anim.type] as Primitive<AnimationType>)(anim, state, ctx);
}

/** Visible interval of an element within its scene, in scene-local seconds. */
export function elementWindow(element: Pick<Element, 'start' | 'end'>, sceneDuration: number): [number, number] {
  const end = element.end === null ? sceneDuration : Math.min(element.end, sceneDuration);
  return [element.start, end];
}

/**
 * Render state of an element at scene-local time, or null if it is not visible.
 */
export function evaluateElement(element: Element, sceneTime: number, sceneDuration: number): ElementState | null {
  const [start, end] = elementWindow(element, sceneDuration);
  if (sceneTime < start || sceneTime >= end) return null;
  const state: ElementState = {
    dx: 0,
    dy: 0,
    scale: element.scale,
    opacity: element.opacity,
    rotation: element.rotation,
    reveal: 1,
    tracking: 0,
  };
  const ctx: AnimationContext = { time: sceneTime - start, lifetime: end - start };
  for (const anim of element.animations) applyAnimation(anim, state, ctx);
  state.opacity = Math.max(0, Math.min(1, state.opacity));
  state.scale = Math.max(0, state.scale);
  return state;
}
