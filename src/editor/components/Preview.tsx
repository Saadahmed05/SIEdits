/**
 * Live preview: draws the project with the same engine used for export. Supports playback,
 * scrubbing, click-to-select and drag-to-move for elements of the scene under the playhead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderFrame } from '../../engine/render';
import { sceneIndexAt, sceneSpans, totalDuration } from '../../engine/timeline';
import type { AssetResolver, ElementBox } from '../../engine/types';
import type { Project } from '../../project/schema';
import { createBrowserEnv } from '../runtime';

export interface PreviewProps {
  project: Project;
  assets: AssetResolver;
  assetsVersion: number;
  time: number;
  playing: boolean;
  onTimeChange: (t: number) => void;
  onPlayingChange: (p: boolean) => void;
  selectedSceneId: string | null;
  selectedElementId: string | null;
  onSelect: (sceneId: string, elementId: string | null) => void;
  onMoveElement: (sceneId: string, elementId: string, x: number, y: number, commitKey: string) => void;
  fontsReady: boolean;
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

export function Preview(props: PreviewProps) {
  const { project, time, playing, onTimeChange, onPlayingChange, assets, assetsVersion, fontsReady } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxesRef = useRef<ElementBox[]>([]);
  const [size, setSize] = useState({ w: 640, h: 360 });
  const duration = useMemo(() => totalDuration(project.scenes), [project.scenes]);
  const { width: W, height: H } = project.settings;

  // Fit the canvas into the available area, preserving aspect ratio.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const scale = Math.min(rect.width / W, rect.height / H);
      setSize({ w: Math.max(1, Math.floor(W * scale)), h: Math.max(1, Math.floor(H * scale)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [W, H]);

  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const pixelRatio = (size.w * dpr) / W;
  const env = useMemo(() => createBrowserEnv(assets, pixelRatio), [assets, pixelRatio]);

  const draw = useCallback(
    (t: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      boxesRef.current = renderFrame(ctx, project, t, env);
      // Selection outline for the selected element.
      const box = boxesRef.current.find((b) => b.elementId === props.selectedElementId && b.sceneId === props.selectedSceneId);
      if (box && !playing) {
        ctx.save();
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        ctx.strokeStyle = '#4da3ff';
        ctx.lineWidth = 1.5 / pixelRatio;
        ctx.setLineDash([6 / pixelRatio, 4 / pixelRatio]);
        ctx.strokeRect(box.x, box.y, box.width, box.height);
        ctx.restore();
      }
    },
    [project, env, pixelRatio, playing, props.selectedElementId, props.selectedSceneId],
  );

  // Redraw when anything that affects the frame changes (and fonts/images become ready).
  useEffect(() => {
    if (!playing) draw(time);
  }, [draw, time, playing, assetsVersion, fontsReady]);

  // Playback loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const startWall = performance.now();
    const startT = time >= duration - 1e-3 ? 0 : time;
    const tick = (now: number) => {
      const t = startT + (now - startWall) / 1000;
      if (t >= duration) {
        draw(duration);
        onTimeChange(duration);
        onPlayingChange(false);
        return;
      }
      draw(t);
      onTimeChange(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration, draw]);

  // Pointer: select and drag elements.
  const drag = useRef<{ sceneId: string; elementId: string; dx: number; dy: number; key: string } | null>(null);
  const toProject = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * W, y: ((e.clientY - rect.top) / rect.height) * H };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (playing) onPlayingChange(false);
    const p = toProject(e);
    const hits = boxesRef.current.filter((b) => p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height);
    // Prefer the smallest box (topmost small element over full-frame particles).
    const hit = hits.sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const sceneId = project.scenes[sceneIndexAt(sceneSpans(project.scenes), time)]?.id;
    if (!hit) {
      if (sceneId) props.onSelect(sceneId, null);
      return;
    }
    props.onSelect(hit.sceneId, hit.elementId);
    const el = project.scenes.find((s) => s.id === hit.sceneId)?.elements.find((x) => x.id === hit.elementId);
    if (!el || el.type === 'particles') return;
    drag.current = { sceneId: hit.sceneId, elementId: hit.elementId, dx: el.x * W - p.x, dy: el.y * H - p.y, key: `drag-${Date.now()}` };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toProject(e);
    const x = Math.round(((p.x + d.dx) / W) * 1000) / 1000;
    const y = Math.round(((p.y + d.dy) / H) * 1000) / 1000;
    props.onMoveElement(d.sceneId, d.elementId, Math.min(2, Math.max(-1, x)), Math.min(2, Math.max(-1, y)), d.key);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="preview">
      <div className="preview-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          data-testid="preview-canvas"
          width={Math.round(size.w * dpr)}
          height={Math.round(size.h * dpr)}
          style={{ width: size.w, height: size.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
