/**
 * Scene timing. A scene's transition overlaps the end of the previous scene:
 *   start[0] = 0
 *   start[i] = start[i-1] + duration[i-1] - transition[i]
 *   total    = start[last] + duration[last]
 */
import { effectiveTransitionDuration, type Project, type Scene } from '../project/schema';

export interface SceneSpan {
  index: number;
  scene: Scene;
  start: number;
  end: number;
  /** Seconds this scene overlaps the previous one (0 for the first scene). */
  transitionIn: number;
}

export function sceneSpans(scenes: readonly Scene[]): SceneSpan[] {
  const spans: SceneSpan[] = [];
  let cursor = 0;
  scenes.forEach((scene, index) => {
    const transitionIn = index === 0 ? 0 : effectiveTransitionDuration(scene);
    const start = index === 0 ? 0 : cursor - transitionIn;
    const end = start + scene.duration;
    spans.push({ index, scene, start, end, transitionIn });
    cursor = end;
  });
  return spans;
}

export function totalDuration(scenes: readonly Scene[]): number {
  const spans = sceneSpans(scenes);
  return spans.length ? spans[spans.length - 1]!.end : 0;
}

/** Number of frames to render. A frame is rendered at t = frame / fps for frame in [0, count). */
export function frameCount(project: Pick<Project, 'scenes' | 'settings'>): number {
  return Math.max(1, Math.round(totalDuration(project.scenes) * project.settings.fps));
}

export function frameTime(frame: number, fps: number): number {
  return frame / fps;
}

export interface ActiveScene {
  span: SceneSpan;
  /** Time relative to the scene start. */
  localTime: number;
  /** Transition progress in [0, 1] if this scene is transitioning in at this moment, else null. */
  transitionProgress: number | null;
}

/**
 * Scenes visible at `time`, bottom-most first. Usually one scene; two during a transition.
 * Time at or past the end shows the last scene's final moment.
 */
export function activeScenes(spans: readonly SceneSpan[], time: number): ActiveScene[] {
  if (spans.length === 0) return [];
  const last = spans[spans.length - 1]!;
  const t = Math.max(0, Math.min(time, last.end - 1e-9));
  const result: ActiveScene[] = [];
  for (const span of spans) {
    if (t >= span.start && t < span.end) {
      const localTime = t - span.start;
      const transitionProgress =
        span.transitionIn > 0 && localTime < span.transitionIn ? localTime / span.transitionIn : null;
      result.push({ span, localTime, transitionProgress });
    }
  }
  return result;
}

/** Index of the scene that "owns" a time (the top-most visible scene). */
export function sceneIndexAt(spans: readonly SceneSpan[], time: number): number {
  const active = activeScenes(spans, time);
  return active.length ? active[active.length - 1]!.span.index : 0;
}
