/**
 * renderFrame: draw the whole project at a point in time onto a Canvas 2D context.
 * Used by both the browser preview and the Node exporter, so preview == export.
 */
import type { Project, Scene, Transition } from '../project/schema';
import { evaluateElement } from './animation';
import { drawBackground, drawers, type DrawContext } from './draw';
import { ease } from './easing';
import { activeScenes, sceneSpans } from './timeline';
import type { Ctx2D, ElementBox, RenderEnv, Surface } from './types';

/** Draw one scene at scene-local time. Appends hit-test boxes to `boxes` if given. */
export function drawScene(
  ctx: Ctx2D,
  project: Project,
  scene: Scene,
  localTime: number,
  env: RenderEnv,
  boxes?: ElementBox[],
): void {
  const { width: W, height: H } = project.settings;
  drawBackground(ctx, scene.background, project.brand, W, H, localTime);

  for (const element of scene.elements) {
    const state = evaluateElement(element, localTime, scene.duration);
    if (!state || state.opacity <= 0 || state.scale <= 0) continue;
    const ax = (element.x + state.dx) * W;
    const ay = (element.y + state.dy) * H;
    ctx.save();
    ctx.globalAlpha *= state.opacity;
    ctx.translate(ax, ay);
    if (state.rotation) ctx.rotate((state.rotation * Math.PI) / 180);
    ctx.scale(state.scale, state.scale);
    const dc: DrawContext = { ctx, width: W, height: H, brand: project.brand, env, elementTime: localTime - element.start };
    const draw = drawers[element.type] as (dc: DrawContext, el: typeof element, s: typeof state) => ReturnType<(typeof drawers)['text']>;
    const local = draw(dc, element, state);
    ctx.restore();
    boxes?.push({
      sceneId: scene.id,
      elementId: element.id,
      x: ax + local.x * state.scale,
      y: ay + local.y * state.scale,
      width: local.width * state.scale,
      height: local.height * state.scale,
    });
  }
}

const surfaceCache = new WeakMap<RenderEnv, Surface>();

function offscreen(env: RenderEnv, W: number, H: number): Surface {
  const pw = Math.max(1, Math.round(W * env.pixelRatio));
  const ph = Math.max(1, Math.round(H * env.pixelRatio));
  let surface = surfaceCache.get(env);
  if (!surface || surface.canvas.width !== pw || surface.canvas.height !== ph) {
    surface = env.createSurface(pw, ph);
    surfaceCache.set(env, surface);
  }
  surface.ctx.setTransform(1, 0, 0, 1, 0, 0);
  surface.ctx.clearRect(0, 0, pw, ph);
  surface.ctx.globalAlpha = 1;
  surface.ctx.setTransform(env.pixelRatio, 0, 0, env.pixelRatio, 0, 0);
  return surface;
}

function drawTransition(
  ctx: Ctx2D,
  project: Project,
  outgoing: { scene: Scene; time: number },
  incoming: { scene: Scene; time: number },
  transition: Transition,
  rawProgress: number,
  env: RenderEnv,
  boxes: ElementBox[],
): void {
  const { width: W, height: H } = project.settings;
  const p = ease('ease-in-out', rawProgress);

  switch (transition.type) {
    case 'slide-left':
    case 'slide-up': {
      const horizontal = transition.type === 'slide-left';
      ctx.save();
      if (horizontal) ctx.translate(-p * W, 0);
      else ctx.translate(0, -p * H);
      drawScene(ctx, project, outgoing.scene, outgoing.time, env);
      ctx.restore();
      ctx.save();
      if (horizontal) ctx.translate((1 - p) * W, 0);
      else ctx.translate(0, (1 - p) * H);
      drawScene(ctx, project, incoming.scene, incoming.time, env, boxes);
      ctx.restore();
      return;
    }
    case 'wipe': {
      drawScene(ctx, project, outgoing.scene, outgoing.time, env);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, p * W, H);
      ctx.clip();
      drawScene(ctx, project, incoming.scene, incoming.time, env, boxes);
      ctx.restore();
      return;
    }
    case 'fade':
    case 'zoom':
    case 'none': {
      drawScene(ctx, project, outgoing.scene, outgoing.time, env);
      // Render the incoming scene to a layer so its elements fade as one image.
      const layer = offscreen(env, W, H);
      drawScene(layer.ctx, project, incoming.scene, incoming.time, env, boxes);
      ctx.save();
      ctx.globalAlpha = transition.type === 'none' ? 1 : p;
      if (transition.type === 'zoom') {
        const s = 1.15 - 0.15 * p;
        ctx.translate(W / 2, H / 2);
        ctx.scale(s, s);
        ctx.translate(-W / 2, -H / 2);
      }
      ctx.drawImage(layer.canvas as CanvasImageSource, 0, 0, W, H);
      ctx.restore();
      return;
    }
  }
}

/**
 * Draw the project at `time` seconds. The context's canvas should be
 * (settings.width × pixelRatio) by (settings.height × pixelRatio) pixels.
 * Returns hit-test boxes (project pixels) of elements drawn in the top-most scene.
 */
export function renderFrame(ctx: Ctx2D, project: Project, time: number, env: RenderEnv): ElementBox[] {
  const { width: W, height: H } = project.settings;
  ctx.save();
  ctx.setTransform(env.pixelRatio, 0, 0, env.pixelRatio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, W, H);

  const boxes: ElementBox[] = [];
  const active = activeScenes(sceneSpans(project.scenes), time);
  const top = active[active.length - 1];
  if (top) {
    if (active.length >= 2 && top.transitionProgress !== null) {
      const below = active[active.length - 2]!;
      drawTransition(
        ctx,
        project,
        { scene: below.span.scene, time: below.localTime },
        { scene: top.span.scene, time: top.localTime },
        top.span.scene.transition,
        top.transitionProgress,
        env,
        boxes,
      );
    } else {
      drawScene(ctx, project, top.span.scene, top.localTime, env, boxes);
    }
  }
  ctx.restore();
  return boxes;
}
