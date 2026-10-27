/**
 * Storyboard → Project compiler. Deterministic: the same storyboard and settings always
 * produce the same project (apart from the project id and timestamps passed in).
 */
import type { z } from 'zod';
import { PROJECT_FORMAT, PROJECT_VERSION, ProjectSchema, type Project, type Settings } from '../project/schema';
import { MOOD_STYLES } from './moods';
import { compileScene, SCENE_KIND_LABELS, type CompileContext } from './scene-kinds';
import type { Storyboard } from './schema';

export interface CompileOptions {
  id: string;
  name?: string;
  settings: Settings;
  now: string;
  generation?: z.input<typeof ProjectSchema>['generation'];
}

/** Transition length used between two scenes; kept short relative to both scenes. */
export function transitionDurationFor(prev: number, current: number): number {
  return +Math.min(0.6, 0.25 * Math.min(prev, current)).toFixed(3);
}

export function compileStoryboard(board: Storyboard, options: CompileOptions): Project {
  const style = MOOD_STYLES[board.mood];
  const brand = {
    ...style.brand,
    ...board.palette,
    headingFont: board.headingFont ?? style.brand.headingFont,
  };
  const counters = new Map<string, number>();
  const ctx: CompileContext = {
    style,
    productName: board.productName,
    tagline: board.tagline,
    portrait: options.settings.height > options.settings.width,
    aspect: options.settings.width / options.settings.height,
    nextId: (prefix) => {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}-${n}`;
    },
  };

  const scenes = board.scenes.map((scene, i) => {
    const prev = board.scenes[i - 1];
    const transition = prev ? transitionDurationFor(prev.duration, scene.duration) : 0;
    const compiled = compileScene(
      scene.kind,
      i === 0 ? { ...scene, transition: 'none' } : scene,
      ctx,
      `scene-${i + 1}`,
      `${i + 1}. ${SCENE_KIND_LABELS[scene.kind]}`,
      transition,
    );
    return compiled;
  });

  // The project schema applies defaults and re-validates everything the compiler produced.
  return ProjectSchema.parse({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: options.id,
    name: options.name?.trim() || board.title,
    createdAt: options.now,
    updatedAt: options.now,
    settings: options.settings,
    brand,
    assets: [],
    scenes,
    generation: options.generation,
  });
}
