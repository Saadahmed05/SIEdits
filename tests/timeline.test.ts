import { describe, expect, it } from 'vitest';
import { activeScenes, frameCount, sceneIndexAt, sceneSpans, totalDuration } from '../src/engine/timeline';
import { smallProject } from './fixtures';

describe('scene timeline', () => {
  const project = smallProject(); // 1s + 1s with a 0.5s fade overlap

  it('overlaps a scene with the end of the previous one by its transition', () => {
    const spans = sceneSpans(project.scenes);
    expect(spans.map((s) => [s.start, s.end, s.transitionIn])).toEqual([
      [0, 1, 0],
      [0.5, 1.5, 0.5],
    ]);
    expect(totalDuration(project.scenes)).toBe(1.5);
  });

  it('ignores the first scene transition and "none" transitions', () => {
    const p = smallProject();
    p.scenes[0]!.transition = { type: 'fade', duration: 0.5 };
    p.scenes[1]!.transition = { type: 'none', duration: 0.5 };
    expect(totalDuration(p.scenes)).toBe(2);
  });

  it('computes frame count from duration and fps', () => {
    expect(frameCount(project)).toBe(15);
    expect(frameCount({ ...project, settings: { ...project.settings, fps: 30 } })).toBe(45);
  });

  it('reports one scene outside transitions and two during them', () => {
    const spans = sceneSpans(project.scenes);
    expect(activeScenes(spans, 0.25).map((a) => a.span.scene.id)).toEqual(['s1']);
    const during = activeScenes(spans, 0.75);
    expect(during.map((a) => a.span.scene.id)).toEqual(['s1', 's2']);
    expect(during[1]!.transitionProgress).toBeCloseTo(0.5);
    expect(during[1]!.localTime).toBeCloseTo(0.25);
    expect(activeScenes(spans, 1.2).map((a) => a.span.scene.id)).toEqual(['s2']);
  });

  it('clamps times outside the project to its first/last frame', () => {
    const spans = sceneSpans(project.scenes);
    expect(activeScenes(spans, -5)[0]!.span.scene.id).toBe('s1');
    expect(activeScenes(spans, 99).map((a) => a.span.scene.id)).toEqual(['s2']);
    expect(sceneIndexAt(spans, 0.75)).toBe(1);
  });
});
