/**
 * Motion-graphics overlays on footage: SceneWright scenes with a transparent background,
 * placed on a timeline as "composition clips". This is the format-v2 graphics track in
 * miniature, drawn with the unmodified SceneWright engine (drawScene).
 */
import type { z } from 'zod';
import { drawScene } from '../../src/engine/render';
import type { Ctx2D, RenderEnv } from '../../src/engine/types';
import { ProjectSchema, type Project } from '../../src/project/schema';

type SceneInput = z.input<typeof ProjectSchema>['scenes'][number];
type ElementInput = NonNullable<SceneInput['elements']>[number];

export interface GraphicClip {
  sceneId: string;
  /** Seconds on the output timeline. */
  start: number;
}

export interface OverlayTrack {
  project: Project;
  clips: GraphicClip[];
}

export type CalloutTemplateId = 'hook-title' | 'lower-third' | 'stat-card' | 'list-item';

const CLEAR = { type: 'solid', color: '#00000000' } as const;
const OUT = 0.25;

/** "Main | detail" → two lines; the second part is optional. */
function split(text: string): [string, string] {
  const [main, ...rest] = text.split('|');
  return [main!.trim(), rest.join('|').trim()];
}

/** Template elements for one callout. Positions are fractions of a 9:16 frame. */
function templateElements(template: CalloutTemplateId, text: string): ElementInput[] {
  const [main, detail] = split(text);
  switch (template) {
    case 'hook-title':
      return [
        {
          id: 'pill',
          type: 'shape',
          shape: 'rect',
          y: 0.16,
          width: 0.86,
          // Fits two lines of title text.
          height: 0.12,
          cornerRadius: 0.025,
          fill: '@primary',
          animations: [{ type: 'scale-in', duration: 0.35, easing: 'ease-out-back' }, { type: 'fade-out', duration: OUT }],
        },
        {
          id: 'title',
          type: 'text',
          text: main,
          y: 0.16,
          size: 0.045,
          weight: 800,
          uppercase: true,
          maxWidth: 0.8,
          lineHeight: 1.05,
          animations: [{ type: 'tracking-in', duration: 0.5, from: 0.3 }, { type: 'fade-out', duration: OUT }],
        },
      ];
    case 'lower-third':
      return [
        {
          id: 'bar',
          type: 'shape',
          shape: 'rect',
          x: 0.36,
          y: 0.8,
          width: 0.62,
          height: 0.085,
          cornerRadius: 0.012,
          fill: '#111827e6',
          animations: [{ type: 'slide-in', direction: 'right', distance: 0.4, duration: 0.45 }, { type: 'fade-out', duration: 0.3 }],
        },
        {
          id: 'name',
          type: 'text',
          text: main,
          x: 0.09,
          y: detail ? 0.787 : 0.8,
          align: 'left',
          size: 0.03,
          weight: 700,
          maxWidth: 0.56,
          animations: [{ type: 'fade-in', delay: 0.2, duration: 0.3 }, { type: 'fade-out', duration: 0.3 }],
        },
        ...(detail
          ? [
              {
                id: 'role',
                type: 'text' as const,
                text: detail,
                x: 0.09,
                y: 0.818,
                align: 'left' as const,
                size: 0.019,
                weight: 500 as const,
                color: '@accent',
                maxWidth: 0.56,
                animations: [{ type: 'fade-in' as const, delay: 0.3, duration: 0.3 }, { type: 'fade-out' as const, duration: 0.3 }],
              },
            ]
          : []),
      ];
    case 'stat-card':
      return [
        {
          id: 'card',
          type: 'shape',
          shape: 'rect',
          y: 0.3,
          width: 0.56,
          height: 0.16,
          cornerRadius: 0.02,
          fill: '#ffffffee',
          animations: [{ type: 'scale-in', duration: 0.4, easing: 'ease-out-back' }, { type: 'scale-out', duration: OUT }],
        },
        {
          id: 'number',
          type: 'text',
          text: main,
          y: detail ? 0.285 : 0.3,
          size: 0.07,
          weight: 800,
          color: '@primary',
          maxWidth: 0.52,
          animations: [{ type: 'scale-in', delay: 0.1, duration: 0.4 }, { type: 'scale-out', duration: OUT }],
        },
        ...(detail
          ? [
              {
                id: 'label',
                type: 'text' as const,
                text: detail,
                y: 0.34,
                size: 0.018,
                weight: 600 as const,
                color: '@secondary',
                maxWidth: 0.5,
                animations: [{ type: 'fade-in' as const, delay: 0.25, duration: 0.3 }, { type: 'fade-out' as const, duration: OUT }],
              },
            ]
          : []),
      ];
    case 'list-item':
      return [
        {
          id: 'card',
          type: 'shape',
          shape: 'rect',
          y: 0.25,
          width: 0.84,
          height: 0.075,
          cornerRadius: 0.015,
          fill: '#111827e6',
          animations: [{ type: 'slide-in', direction: 'right', distance: 0.3, duration: 0.4 }, { type: 'fade-out', duration: OUT }],
        },
        {
          id: 'badge',
          type: 'shape',
          shape: 'ellipse',
          x: 0.15,
          y: 0.25,
          width: 0.09,
          height: 0.05,
          fill: '@accent',
          animations: [{ type: 'scale-in', delay: 0.15, duration: 0.3, easing: 'ease-out-back' }, { type: 'fade-out', duration: OUT }],
        },
        {
          id: 'text',
          type: 'text',
          text: main,
          x: 0.22,
          y: 0.25,
          align: 'left',
          size: 0.026,
          weight: 700,
          maxWidth: 0.68,
          animations: [{ type: 'fade-in', delay: 0.2, duration: 0.3 }, { type: 'fade-out', duration: OUT }],
        },
      ];
  }
}

export interface CalloutClip {
  id: string;
  template: CalloutTemplateId;
  text: string;
  start: number;
  end: number;
}

const BRAND = { primary: '#6d5dfc', secondary: '#111827', accent: '#ffd43b', background: '#000000', text: '#ffffff' };

/** Build an overlay track (one SceneWright scene per callout) for a W×H output. */
export function calloutTrack(callouts: readonly CalloutClip[], width: number, height: number, fps: number): OverlayTrack {
  const project = ProjectSchema.parse({
    format: 'scenewright.project',
    version: 1,
    id: 'overlays',
    name: 'Overlays',
    createdAt: '2026-10-27T00:00:00.000Z',
    updatedAt: '2026-10-27T00:00:00.000Z',
    settings: { width, height, fps },
    brand: BRAND,
    scenes: callouts.length
      ? callouts.map((c) => ({ id: c.id, duration: Math.max(0.1, c.end - c.start), background: CLEAR, elements: templateElements(c.template, c.text) }))
      : [{ id: 'empty', duration: 1, background: CLEAR }],
  });
  return { project, clips: callouts.map((c) => ({ sceneId: c.id, start: c.start })) };
}

/** A hook title, a lower third and a stat card: the kinds of graphics an educator reel uses. */
export function demoOverlays(width: number, height: number, fps: number): OverlayTrack {
  return calloutTrack(
    [
      { id: 'hook', template: 'hook-title', text: '3 coding mistakes', start: 0.2, end: 2.8 },
      { id: 'lower-third', template: 'lower-third', text: 'Sam Rivera | Senior engineer · teaches Python', start: 4, end: 9 },
      { id: 'stat', template: 'stat-card', text: '87% | of beginners quit in month one', start: 14, end: 18 },
    ],
    width,
    height,
    fps,
  );
}

/** Draw every graphic clip active at time t. The context must be W×H at pixel ratio 1. */
export function drawOverlays(ctx: Ctx2D, track: OverlayTrack, t: number, env: RenderEnv): void {
  for (const clip of track.clips) {
    const scene = track.project.scenes.find((s) => s.id === clip.sceneId);
    if (!scene) continue;
    const local = t - clip.start;
    if (local < 0 || local >= scene.duration) continue;
    ctx.save();
    drawScene(ctx, track.project, scene, local, env);
    ctx.restore();
  }
}
