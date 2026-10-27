import { useEffect, useMemo, useRef, useState } from 'react';
import { drawScene } from '../../engine/render';
import { sceneSpans } from '../../engine/timeline';
import type { AssetResolver } from '../../engine/types';
import { createScene, deleteScene, duplicateScene, insertScene, moveScene } from '../../project/edit';
import { newId } from '../../project/ids';
import type { Project, Scene } from '../../project/schema';
import { MOOD_STYLES } from '../../storyboard/moods';
import { compileScene, SCENE_KIND_LABELS } from '../../storyboard/scene-kinds';
import { SCENE_KINDS, StoryboardSceneSchema, type SceneKind } from '../../storyboard/schema';
import { SceneSchema } from '../../project/schema';
import { createBrowserEnv } from '../runtime';

const THUMB_W = 160;

function SceneThumb({ project, scene, assets, version }: { project: Project; scene: Scene; assets: AssetResolver; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width: W, height: H } = project.settings;
  const thumbH = Math.round((THUMB_W * H) / W);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const pr = (THUMB_W * 2) / W;
    const env = createBrowserEnv(assets, pr);
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    // Show the scene once its main content has animated in.
    drawScene(ctx, project, scene, Math.min(scene.duration * 0.6, Math.max(0, scene.duration - 0.6)), env);
  }, [project, scene, assets, version, W]);
  return <canvas ref={ref} width={THUMB_W * 2} height={thumbH * 2} style={{ width: THUMB_W, height: thumbH }} />;
}

/** Build a scene of a storyboard kind using the project's current brand and background. */
function sceneFromKind(project: Project, kind: SceneKind, background: Scene['background']): Scene {
  const style = { ...MOOD_STYLES['dark-cinematic'], brand: project.brand, background, emphasisBackground: background, particles: false, glow: false };
  const productName = project.generation?.brief ? project.name.split(/\s+—\s+/)[0]! : project.name;
  const spec = StoryboardSceneSchema.parse({
    kind,
    duration: 3,
    headline: kind === 'logo-reveal' ? productName : kind === 'stat' ? '3x faster' : 'Your headline',
    subheadline: kind === 'call-to-action' ? 'Get started' : 'Supporting line',
    items: kind === 'feature-list' ? ['First feature', 'Second feature', 'Third feature'] : kind === 'kinetic-text' ? ['Bold', 'Fast', 'Yours'] : [],
    transition: 'fade',
  });
  const prefix = newId('', 4);
  const compiled = compileScene(
    kind,
    spec,
    {
      style,
      productName,
      tagline: '',
      portrait: project.settings.height > project.settings.width,
      aspect: project.settings.width / project.settings.height,
      nextId: (p) => newId(`${p}-${prefix}`, 4),
    },
    newId('scene'),
    SCENE_KIND_LABELS[kind],
    0.5,
  );
  return SceneSchema.parse(compiled);
}

interface Props {
  project: Project;
  assets: AssetResolver;
  assetsVersion: number;
  selectedSceneId: string | null;
  onSelect: (sceneId: string) => void;
  edit: (fn: (p: Project) => Project, key?: string) => void;
}

export function ScenesPanel({ project, assets, assetsVersion, selectedSceneId, onSelect, edit }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const spans = useMemo(() => sceneSpans(project.scenes), [project.scenes]);
  const selected = project.scenes.find((s) => s.id === selectedSceneId) ?? project.scenes[0]!;

  const add = (kind: SceneKind | 'blank') => {
    const scene = kind === 'blank' ? createScene(selected.background) : sceneFromKind(project, kind, selected.background);
    edit((p) => insertScene(p, scene, selected.id));
    onSelect(scene.id);
    setMenuOpen(false);
  };

  return (
    <aside className="scenes-panel" aria-label="Scenes">
      <header className="panel-header">
        <h2>Scenes</h2>
        <div className="menu-anchor">
          <button className="btn small" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
            + Add
          </button>
          {menuOpen && (
            <div className="menu" role="menu">
              <button role="menuitem" onClick={() => add('blank')}>
                Blank scene
              </button>
              {SCENE_KINDS.map((k) => (
                <button role="menuitem" key={k} onClick={() => add(k)}>
                  {SCENE_KIND_LABELS[k]}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <ol className="scene-list">
        {project.scenes.map((scene, i) => (
          <li key={scene.id} className={scene.id === selected.id ? 'selected' : ''}>
            <button className="scene-card" onClick={() => onSelect(scene.id)} aria-label={`Select scene ${scene.name}`}>
              <SceneThumb project={project} scene={scene} assets={assets} version={assetsVersion} />
              <div className="scene-meta">
                <span className="scene-name">{scene.name}</span>
                <span className="muted small">
                  {scene.duration.toFixed(1)}s · {spans[i]!.start.toFixed(1)}s
                  {i > 0 && scene.transition.type !== 'none' ? ` · ${scene.transition.type}` : ''}
                </span>
              </div>
            </button>
            {scene.id === selected.id && (
              <div className="scene-actions">
                <button className="icon-btn" title="Move up" aria-label="Move scene up" disabled={i === 0} onClick={() => edit((p) => moveScene(p, scene.id, -1))}>
                  ↑
                </button>
                <button className="icon-btn" title="Move down" aria-label="Move scene down" disabled={i === project.scenes.length - 1} onClick={() => edit((p) => moveScene(p, scene.id, 1))}>
                  ↓
                </button>
                <button
                  className="icon-btn"
                  title="Duplicate"
                  aria-label="Duplicate scene"
                  onClick={() => {
                    // Computed outside the reducer: duplicating generates random ids.
                    const r = duplicateScene(project, scene.id);
                    edit(() => r.project);
                    onSelect(r.sceneId);
                  }}
                >
                  ⧉
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete"
                  aria-label="Delete scene"
                  disabled={project.scenes.length <= 1}
                  onClick={() => {
                    const next = project.scenes[i + 1] ?? project.scenes[i - 1];
                    edit((p) => deleteScene(p, scene.id));
                    if (next) onSelect(next.id);
                  }}
                >
                  ✕
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </aside>
  );
}
