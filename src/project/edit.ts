/**
 * Pure edit operations on a project. The editor composes these; they never mutate their input.
 * Inputs are not validated here — the editor validates the result with parseProject before saving.
 */
import type { z } from 'zod';
import { newId } from './ids';
import {
  AnimationSchema,
  ElementSchema,
  SceneSchema,
  type Animation,
  type Asset,
  type Brand,
  type Element,
  type ElementType,
  type Project,
  type Scene,
} from './schema';

export type ScenePatch = Partial<Omit<Scene, 'id' | 'elements'>>;
export type ElementPatch = Partial<Element>;

const mapScene = (project: Project, sceneId: string, fn: (s: Scene) => Scene): Project => ({
  ...project,
  scenes: project.scenes.map((s) => (s.id === sceneId ? fn(s) : s)),
});

export function updateScene(project: Project, sceneId: string, patch: ScenePatch): Project {
  return mapScene(project, sceneId, (s) => ({ ...s, ...patch }));
}

export function updateElement(project: Project, sceneId: string, elementId: string, patch: ElementPatch): Project {
  return mapScene(project, sceneId, (s) => ({
    ...s,
    elements: s.elements.map((e) => (e.id === elementId ? ({ ...e, ...patch } as Element) : e)),
  }));
}

export function updateBrand(project: Project, patch: Partial<Brand>): Project {
  return { ...project, brand: { ...project.brand, ...patch } };
}

export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const copy = [...items];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item!);
  return copy;
}

export function moveScene(project: Project, sceneId: string, delta: number): Project {
  const index = project.scenes.findIndex((s) => s.id === sceneId);
  return { ...project, scenes: moveItem(project.scenes, index, delta) };
}

export function deleteScene(project: Project, sceneId: string): Project {
  if (project.scenes.length <= 1) return project;
  return { ...project, scenes: project.scenes.filter((s) => s.id !== sceneId) };
}

export function insertScene(project: Project, scene: Scene, afterSceneId?: string): Project {
  const index = afterSceneId ? project.scenes.findIndex((s) => s.id === afterSceneId) : project.scenes.length - 1;
  const scenes = [...project.scenes];
  scenes.splice(index + 1, 0, scene);
  return { ...project, scenes };
}

export function duplicateScene(project: Project, sceneId: string): { project: Project; sceneId: string } {
  const source = project.scenes.find((s) => s.id === sceneId);
  if (!source) return { project, sceneId };
  const copy: Scene = {
    ...structuredClone(source),
    id: newId('scene'),
    name: `${source.name} (copy)`,
    transition: source.transition.type === 'none' ? { type: 'fade', duration: Math.min(0.5, source.duration / 4) } : source.transition,
  };
  return { project: insertScene(project, copy, sceneId), sceneId: copy.id };
}

export function addElement(project: Project, sceneId: string, element: Element): Project {
  return mapScene(project, sceneId, (s) => ({ ...s, elements: [...s.elements, element] }));
}

export function deleteElement(project: Project, sceneId: string, elementId: string): Project {
  return mapScene(project, sceneId, (s) => ({ ...s, elements: s.elements.filter((e) => e.id !== elementId) }));
}

export function moveElement(project: Project, sceneId: string, elementId: string, delta: number): Project {
  return mapScene(project, sceneId, (s) => ({
    ...s,
    elements: moveItem(
      s.elements,
      s.elements.findIndex((e) => e.id === elementId),
      delta,
    ),
  }));
}

export function addAsset(project: Project, asset: Asset): Project {
  return { ...project, assets: [...project.assets, asset] };
}

/** Removes an asset and clears references to it (logo/device fall back to generated art). */
export function removeAsset(project: Project, assetId: string): Project {
  return {
    ...project,
    assets: project.assets.filter((a) => a.id !== assetId),
    scenes: project.scenes.map((s) => ({
      ...s,
      elements: s.elements
        .filter((e) => !(e.type === 'image' && e.assetId === assetId))
        .map((e) => ((e.type === 'logo' || e.type === 'device') && e.assetId === assetId ? { ...e, assetId: null } : e)),
    })),
  };
}

type ElementInput = z.input<typeof ElementSchema>;

/** A new element of the given type with sensible defaults, centred in the frame. */
export function createElement(type: ElementType, opts: { assetId?: string } = {}): Element {
  const id = newId('el');
  const fade = [{ type: 'fade-in' as const, duration: 0.5 }];
  const inputs: Record<ElementType, ElementInput> = {
    text: { id, type: 'text', name: 'Text', text: 'New text', size: 0.07, animations: fade },
    shape: { id, type: 'shape', name: 'Shape', shape: 'rect', width: 0.2, height: 0.2, cornerRadius: 0.02, animations: fade },
    image: { id, type: 'image', name: 'Image', assetId: opts.assetId ?? 'missing', width: 0.4, cornerRadius: 0.01, shadow: true, animations: fade },
    logo: { id, type: 'logo', name: 'Logo', wordmark: 'Brand', assetId: opts.assetId ?? null, animations: fade },
    device: { id, type: 'device', name: 'Screenshot', assetId: opts.assetId ?? null, animations: fade },
    particles: { id, type: 'particles', name: 'Particles', seed: Math.floor(Math.random() * 1000) },
  };
  return ElementSchema.parse(inputs[type]);
}

export function createAnimation(type: Animation['type']): Animation {
  const base: Record<Animation['type'], z.input<typeof AnimationSchema>> = {
    'fade-in': { type: 'fade-in', duration: 0.5 },
    'fade-out': { type: 'fade-out', duration: 0.4, easing: 'ease-in' },
    'slide-in': { type: 'slide-in', duration: 0.7 },
    'slide-out': { type: 'slide-out', duration: 0.5, easing: 'ease-in' },
    'scale-in': { type: 'scale-in', duration: 0.6, easing: 'ease-out-back' },
    'scale-out': { type: 'scale-out', duration: 0.5, easing: 'ease-in' },
    zoom: { type: 'zoom', duration: 3, easing: 'linear' },
    'rotate-in': { type: 'rotate-in', duration: 0.8, easing: 'ease-out-back' },
    typewriter: { type: 'typewriter', duration: 1.2, easing: 'linear' },
    'tracking-in': { type: 'tracking-in', duration: 1, easing: 'ease-out-expo' },
    float: { type: 'float' },
    pulse: { type: 'pulse' },
    spin: { type: 'spin' },
  };
  return AnimationSchema.parse(base[type]);
}

export function createScene(background: Scene['background'], duration = 3): Scene {
  return SceneSchema.parse({
    id: newId('scene'),
    name: 'New scene',
    duration,
    background,
    transition: { type: 'fade', duration: 0.5 },
    elements: [createElement('text')],
  });
}
