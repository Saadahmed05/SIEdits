import { describe, expect, it } from 'vitest';
import { elementWindow, evaluateElement } from '../src/engine/animation';
import { ease, easings } from '../src/engine/easing';
import { ElementSchema, EASINGS, type Element } from '../src/project/schema';

const el = (animations: unknown[], extra: Record<string, unknown> = {}): Element =>
  ElementSchema.parse({ id: 'e', type: 'text', text: 'x', animations, ...extra });

describe('easing', () => {
  it('has exact endpoints and clamps input for every easing', () => {
    for (const name of EASINGS) {
      expect(ease(name, 0)).toBe(0);
      expect(ease(name, 1)).toBe(1);
      expect(ease(name, -1)).toBe(0);
      expect(ease(name, 2)).toBe(1);
    }
    expect(easings.linear(0.3)).toBeCloseTo(0.3);
    expect(easings['ease-out'](0.5)).toBeGreaterThan(0.5);
    expect(easings['ease-in'](0.5)).toBeLessThan(0.5);
  });
});

describe('animation primitives', () => {
  it('fade-in goes from 0 to 1 over its duration after its delay', () => {
    const e = el([{ type: 'fade-in', delay: 0.5, duration: 1, easing: 'linear' }]);
    expect(evaluateElement(e, 0, 5)!.opacity).toBe(0);
    expect(evaluateElement(e, 0.5, 5)!.opacity).toBe(0);
    expect(evaluateElement(e, 1, 5)!.opacity).toBeCloseTo(0.5);
    expect(evaluateElement(e, 1.5, 5)!.opacity).toBe(1);
  });

  it('fade-out is anchored to the element end by default', () => {
    const e = el([{ type: 'fade-out', duration: 1, easing: 'linear' }]);
    expect(evaluateElement(e, 3.9, 5)!.opacity).toBe(1);
    expect(evaluateElement(e, 4.5, 5)!.opacity).toBeCloseTo(0.5);
    // Changing the scene duration keeps the exit at the end.
    expect(evaluateElement(e, 8.5, 10)!.opacity).toBe(1);
    expect(evaluateElement(e, 9.5, 10)!.opacity).toBeCloseTo(0.5);
  });

  it('slide-in starts offset opposite to its direction and ends at rest', () => {
    const e = el([{ type: 'slide-in', direction: 'up', distance: 0.2, duration: 1, easing: 'linear' }]);
    expect(evaluateElement(e, 0, 5)!.dy).toBeCloseTo(0.2);
    expect(evaluateElement(e, 0.5, 5)!.dy).toBeCloseTo(0.1);
    expect(evaluateElement(e, 2, 5)!.dy).toBeCloseTo(0);
    const right = el([{ type: 'slide-in', direction: 'right', distance: 0.1, duration: 1 }]);
    expect(evaluateElement(right, 0, 5)!.dx).toBeCloseTo(-0.1);
  });

  it('scale-in, zoom and scale-out compose multiplicatively with the base scale', () => {
    const e = el(
      [
        { type: 'scale-in', from: 0.5, duration: 1, easing: 'linear' },
        { type: 'zoom', from: 1, to: 2, duration: 1, easing: 'linear' },
      ],
      { scale: 2 },
    );
    expect(evaluateElement(e, 0, 5)!.scale).toBeCloseTo(1); // 2 * 0.5 * 1
    expect(evaluateElement(e, 1, 5)!.scale).toBeCloseTo(4); // 2 * 1 * 2
  });

  it('rotate-in turns from its start angle to the base rotation', () => {
    const e = el([{ type: 'rotate-in', from: -90, duration: 1, easing: 'linear' }], { rotation: 10 });
    expect(evaluateElement(e, 0, 5)!.rotation).toBeCloseTo(-80);
    expect(evaluateElement(e, 0.5, 5)!.rotation).toBeCloseTo(-35);
    expect(evaluateElement(e, 2, 5)!.rotation).toBeCloseTo(10);
  });

  it('typewriter and tracking-in drive text reveal and spacing', () => {
    const e = el([
      { type: 'typewriter', duration: 2, easing: 'linear' },
      { type: 'tracking-in', from: 0.4, duration: 1, easing: 'linear' },
    ]);
    expect(evaluateElement(e, 1, 5)).toMatchObject({ reveal: 0.5, tracking: 0 });
    expect(evaluateElement(e, 0.5, 5)!.tracking).toBeCloseTo(0.2);
  });

  it('continuous animations are deterministic functions of time', () => {
    const e = el([{ type: 'float', amplitude: 0.1, period: 2 }, { type: 'spin', speed: 90 }]);
    expect(evaluateElement(e, 0.5, 5)!.dy).toBeCloseTo(0.1);
    expect(evaluateElement(e, 2, 5)!.rotation).toBeCloseTo(180);
    expect(evaluateElement(e, 1.234, 5)).toEqual(evaluateElement(e, 1.234, 5));
  });

  it('elements are only visible inside their start/end window', () => {
    const e = el([], { start: 1, end: 2 });
    expect(elementWindow(e, 5)).toEqual([1, 2]);
    expect(evaluateElement(e, 0.99, 5)).toBeNull();
    expect(evaluateElement(e, 1, 5)).not.toBeNull();
    expect(evaluateElement(e, 2, 5)).toBeNull();
    expect(elementWindow(el([], { start: 0, end: 9 }), 5)).toEqual([0, 5]);
  });

  it('clamps opacity to [0, 1] even with overshooting easings', () => {
    const e = el([{ type: 'fade-in', duration: 1, easing: 'ease-out-back' }]);
    for (let t = 0; t <= 1; t += 0.05) {
      const o = evaluateElement(e, t, 5)!.opacity;
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThanOrEqual(1);
    }
  });
});
