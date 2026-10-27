import type { EASINGS } from '../project/schema';

export type EasingName = (typeof EASINGS)[number];
type EasingFn = (t: number) => number;

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export const easings: Record<EasingName, EasingFn> = {
  linear: (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - (1 - t) ** 3,
  'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  'ease-out-back': (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  'ease-out-expo': (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
  'ease-in-out-expo': (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
};

/** Evaluate an easing at t, clamping t to [0, 1]. Endpoints are exact: ease(0)=0, ease(1)=1. */
export function ease(name: EasingName, t: number): number {
  const c = clamp01(t);
  if (c === 0) return 0;
  if (c === 1) return 1;
  return easings[name](c);
}
