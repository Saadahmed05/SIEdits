import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationReport } from '../../ai/generate';
import { sceneIndexAt, sceneSpans } from '../../engine/timeline';
import { deleteElement, updateElement } from '../../project/edit';
import type { Project } from '../../project/schema';
import type { Health } from '../api';
import { useAssetResolver, useFontsReady } from '../runtime';
import { useProjectState, type SaveStatus } from '../useProjectState';
import { ElementInspector, SceneInspector } from './Inspector';
import { AssetsPanel, BrandPanel, BriefPanel, RenderPanel } from './Panels';
import { Preview } from './Preview';
import { ScenesPanel } from './ScenesPanel';
import { Timeline } from './Timeline';

type Tab = 'properties' | 'brand' | 'brief' | 'export';

function SaveIndicator({ status }: { status: SaveStatus }) {
  switch (status.kind) {
    case 'saved':
      return <span className="save ok" data-testid="save-status">Saved</span>;
    case 'dirty':
    case 'saving':
      return <span className="save busy" data-testid="save-status">Saving…</span>;
    case 'invalid':
      return (
        <span className="save bad" data-testid="save-status" title={status.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}>
          Not saved — {status.issues.length} issue{status.issues.length === 1 ? '' : 's'}
        </span>
      );
    case 'error':
      return (
        <span className="save bad" data-testid="save-status" title={status.issues.map((i) => `${i.path}: ${i.message}`).join('\n')}>
          Save failed: {status.message}
        </span>
      );
  }
}

export function Editor({ initial, health, initialReport, onExit }: { initial: Project; health: Health | null; initialReport: GenerationReport | null; onExit: () => void }) {
  const state = useProjectState(initial);
  const { project, edit } = state;
  // Render the last valid project so a half-typed value never breaks the preview.
  const lastValid = useRef(project);
  if (state.validProject) lastValid.current = state.validProject;
  const view = lastValid.current;

  const fontsReady = useFontsReady();
  const { resolver, version } = useAssetResolver(view);
  // Open on a frame where the first scene's content has animated in, not on an empty t=0.
  const [time, setTime] = useState(() => Math.min(1.5, (initial.scenes[0]?.duration ?? 1) * 0.5));
  const [playing, setPlaying] = useState(false);
  const [sceneId, setSceneId] = useState<string | null>(project.scenes[0]?.id ?? null);
  const [elementId, setElementId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('properties');
  const [report, setReport] = useState<GenerationReport | null>(initialReport);
  const [renderSignal, setRenderSignal] = useState(0);
  const spans = useMemo(() => sceneSpans(view.scenes), [view.scenes]);

  const sceneIndex = Math.max(0, project.scenes.findIndex((s) => s.id === sceneId));
  const scene = project.scenes[sceneIndex]!;
  const element = scene.elements.find((e) => e.id === elementId) ?? null;

  // Keep scene selection in sync with the playhead while playing / scrubbing.
  const seek = useCallback(
    (t: number) => {
      setTime(t);
      const idx = sceneIndexAt(spans, t);
      const id = view.scenes[idx]?.id;
      if (id && id !== sceneId) {
        setSceneId(id);
        setElementId(null);
      }
    },
    [spans, view.scenes, sceneId],
  );

  const selectScene = (id: string) => {
    setSceneId(id);
    setElementId(null);
    setPlaying(false);
    const span = spans.find((s) => s.scene.id === id);
    // Jump to a point where the scene's content is visible.
    if (span) setTime(Math.min(span.end - 0.01, span.start + span.transitionIn + Math.min(1.5, span.scene.duration * 0.5)));
    setTab('properties');
  };

  // If the selected scene disappears (undo/delete), fall back to the first.
  useEffect(() => {
    if (!project.scenes.some((s) => s.id === sceneId)) setSceneId(project.scenes[0]?.id ?? null);
  }, [project.scenes, sceneId]);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      } else if (!typing && e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && elementId) {
        edit((p) => deleteElement(p, scene.id, elementId));
        setElementId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, edit, elementId, scene.id]);

  return (
    <div className="editor">
      <header className="topbar">
        <button className="btn ghost" onClick={onExit} aria-label="Back to projects">
          ← Projects
        </button>
        <input
          className="project-name"
          aria-label="Project name"
          value={project.name}
          maxLength={120}
          onChange={(e) => edit((p) => ({ ...p, name: e.target.value }), 'project-name')}
        />
        <SaveIndicator status={state.status} />
        <div className="spacer" />
        <button className="icon-btn" onClick={state.undo} disabled={!state.canUndo} aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">
          ↶
        </button>
        <button className="icon-btn" onClick={state.redo} disabled={!state.canRedo} aria-label="Redo" title="Redo (Shift+Ctrl/Cmd+Z)">
          ↷
        </button>
        <button
          className="btn primary"
          onClick={() => {
            setTab('export');
            setRenderSignal((n) => n + 1);
          }}
          disabled={state.issues.length > 0}
        >
          Render MP4
        </button>
      </header>

      {state.issues.length > 0 && (
        <div className="issues-banner" role="alert">
          <strong>Project has {state.issues.length} issue(s) and is not being saved:</strong>
          <ul>
            {state.issues.slice(0, 4).map((i, k) => (
              <li key={k}>
                <code>{i.path}</code> — {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="workspace">
        <ScenesPanel project={view} assets={resolver} assetsVersion={version} selectedSceneId={scene.id} onSelect={selectScene} edit={edit} />

        <main className="stage">
          <Preview
            project={view}
            assets={resolver}
            assetsVersion={version}
            fontsReady={fontsReady}
            time={time}
            playing={playing}
            onTimeChange={seek}
            onPlayingChange={setPlaying}
            selectedSceneId={scene.id}
            selectedElementId={elementId}
            onSelect={(sid, eid) => {
              setSceneId(sid);
              setElementId(eid);
              setTab('properties');
            }}
            onMoveElement={(sid, eid, x, y, key) => edit((p) => updateElement(p, sid, eid, { x, y }), key)}
          />
          <Timeline project={view} time={time} playing={playing} selectedSceneId={scene.id} onSeek={seek} onTogglePlay={() => setPlaying((p) => !p)} onSelectScene={selectScene} />
        </main>

        <aside className="inspector" aria-label="Inspector">
          <nav className="tabs" role="tablist">
            {(['properties', 'brand', 'brief', 'export'] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                {t === 'properties' ? 'Properties' : t === 'brand' ? 'Brand' : t === 'brief' ? 'AI brief' : 'Render'}
              </button>
            ))}
          </nav>
          <div className="tab-body">
            {tab === 'properties' && (
              <>
                {element ? (
                  <>
                    <button className="link back" onClick={() => setElementId(null)}>
                      ← {scene.name}
                    </button>
                    <ElementInspector project={project} scene={scene} element={element} edit={edit} />
                  </>
                ) : (
                  <SceneInspector project={project} scene={scene} index={sceneIndex} edit={edit} selectedElementId={elementId} onSelectElement={setElementId} assets={project.assets} />
                )}
              </>
            )}
            {tab === 'brand' && (
              <>
                <BrandPanel project={project} edit={edit} />
                <AssetsPanel project={project} edit={edit} />
              </>
            )}
            {tab === 'brief' && (
              <BriefPanel
                project={project}
                health={health}
                lastReport={report}
                onRegenerated={(p, r) => {
                  state.replace(p, { saved: true, keepHistory: true });
                  setReport(r);
                  setSceneId(p.scenes[0]?.id ?? null);
                  setElementId(null);
                  setTime(Math.min(1.5, (p.scenes[0]?.duration ?? 1) * 0.5));
                }}
              />
            )}
            <div hidden={tab !== 'export'}>
              <RenderPanel project={project} health={health} flush={state.flush} issues={state.issues.length} startSignal={renderSignal} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
