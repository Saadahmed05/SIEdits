import { useEffect, useRef, useState } from 'react';
import type { GenerationReport } from '../../ai/generate';
import type { Project } from '../../project/schema';
import type { ProjectSummary } from '../../server/storage';
import type { Template } from '../../storyboard/templates';
import { api, ApiError, type Health } from '../api';

const FORMATS = [
  { id: '16:9', label: 'Landscape 16:9', width: 1920, height: 1080 },
  { id: '9:16', label: 'Vertical 9:16', width: 1080, height: 1920 },
  { id: '1:1', label: 'Square 1:1', width: 1080, height: 1080 },
  { id: '720p', label: 'Landscape 720p', width: 1280, height: 720 },
];

function NewProject({ health, templates, onCreated }: { health: Health | null; templates: Template[]; onCreated: (p: Project, r: GenerationReport) => void }) {
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('product-launch');
  const template = templates.find((t) => t.id === templateId);
  const [brief, setBrief] = useState('');
  const [briefTouched, setBriefTouched] = useState(false);
  const [format, setFormat] = useState('16:9');
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(12);
  const [provider, setProvider] = useState('auto');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Prefill the brief with the template's example until the user writes their own.
  useEffect(() => {
    if (!briefTouched && template) setBrief(template.defaultBrief);
  }, [template, briefTouched]);

  const aiConfigured = health?.providers.some((p) => p.id !== 'heuristic' && p.configured);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = FORMATS.find((x) => x.id === format)!;
    try {
      const { project, report } = await api.createProject({
        name: name.trim() || undefined,
        brief,
        templateId,
        settings: { width: f.width, height: f.height, fps },
        targetDuration: duration,
        provider,
      });
      onCreated(project, report);
    } catch (err) {
      setError(err as ApiError);
      setBusy(false);
    }
  };

  return (
    <form className="new-project" onSubmit={submit} aria-label="New project">
      <h2>New project</h2>
      <label className="stack">
        <span>Project name</span>
        <input aria-label="New project name" value={name} maxLength={120} placeholder="e.g. Nova launch" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="stack">
        <span>Template</span>
        <div className="template-grid" role="radiogroup" aria-label="Template">
          {templates.map((t) => (
            <button type="button" role="radio" aria-checked={t.id === templateId} key={t.id} className={`template ${t.id === templateId ? 'active' : ''}`} onClick={() => setTemplateId(t.id)}>
              <strong>{t.label}</strong>
              <span className="muted small">{t.description}</span>
            </button>
          ))}
        </div>
      </div>
      {templateId !== 'blank' && (
        <label className="stack">
          <span>Brief</span>
          <textarea
            aria-label="Brief"
            rows={5}
            maxLength={4000}
            value={brief}
            onChange={(e) => {
              setBrief(e.target.value);
              setBriefTouched(true);
            }}
          />
          <span className="muted small">
            {aiConfigured
              ? 'An AI planner is configured. If it fails, the built-in planner is used and you will be told why.'
              : 'No AI provider configured — the built-in offline planner turns the brief into scenes. Add an API key in .env to enable AI planning.'}
          </span>
        </label>
      )}
      <div className="row">
        <label className="stack">
          <span>Format</span>
          <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} ({f.width}×{f.height})
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          <span>Frame rate</span>
          <select aria-label="Frame rate" value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            {[24, 25, 30, 60].map((v) => (
              <option key={v} value={v}>
                {v} fps
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          <span>Length (s)</span>
          <input aria-label="Length in seconds" type="number" min={2} max={120} value={duration} onChange={(e) => setDuration(Math.min(120, Math.max(2, Number(e.target.value) || 2)))} />
        </label>
      </div>
      {templateId !== 'blank' && (
        <label className="stack">
          <span>Planner</span>
          <select aria-label="Planner" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="auto">Auto (AI if configured, otherwise built-in)</option>
            {health?.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.configured}>
                {p.label}
                {p.configured ? '' : ' — not configured'}
              </option>
            ))}
          </select>
        </label>
      )}
      <button className="btn primary large" type="submit" disabled={busy}>
        {busy ? 'Creating…' : templateId === 'blank' ? 'Create project' : 'Generate editable animation'}
      </button>
      {error && (
        <div className="error small" role="alert">
          {error.message}
          {error.issues.map((i, k) => (
            <div key={k}>
              <code>{i.path}</code>: {i.message}
            </div>
          ))}
        </div>
      )}
    </form>
  );
}

export function Home({ health, onOpen }: { health: Health | null; onOpen: (p: Project, report?: GenerationReport) => void }) {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const load = () =>
    api
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    void load();
    api.templates().then((r) => setTemplates(r.templates)).catch((e: Error) => setError(e.message));
  }, []);

  const open = async (id: string) => {
    try {
      onOpen((await api.getProject(id)).project);
    } catch (e) {
      const err = e as ApiError;
      setError(`${err.message}${err.issues.length ? `: ${err.issues.map((i) => `${i.path} ${i.message}`).join('; ')}` : ''}`);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const json = JSON.parse(await file.text());
      const { project, warning } = await api.importProject(json);
      if (warning) window.alert(warning);
      onOpen(project);
    } catch (e) {
      const err = e as ApiError;
      setError(`Import failed: ${err.message}${err.issues?.length ? ` — ${err.issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}` : ''}`);
    } finally {
      if (importRef.current) importRef.current.value = '';
    }
  };

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand-mark">
          <span className="logo-dot" /> SceneWright
        </div>
        <span className="muted small">Open-source motion graphics · brief → editable scenes → MP4</span>
        <div className="spacer" />
        <span className={`status-chip ${health?.ffmpeg ? 'ok' : 'bad'}`} title={health?.ffmpeg ?? 'FFmpeg not found'}>
          {health ? (health.ffmpeg ? 'Renderer ready' : 'FFmpeg missing') : 'Connecting…'}
        </span>
      </header>
      <div className="home-body">
        <NewProject health={health} templates={templates} onCreated={(p, r) => onOpen(p, r)} />
        <section className="project-list" aria-label="Projects">
          <header>
            <h2>Projects</h2>
            <button className="btn small" onClick={() => importRef.current?.click()}>
              Import…
            </button>
            <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Import project file" onChange={(e) => importFile(e.target.files?.[0])} />
          </header>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
          {projects === null && <p className="muted">Loading…</p>}
          {projects?.length === 0 && <p className="muted">No projects yet. Create one on the left, or import a .scenewright.json bundle.</p>}
          <ul>
            {projects?.map((p) => (
              <li key={p.id} className="project-card">
                <button className="project-open" aria-label={`Open project ${p.name}`} onClick={() => open(p.id)}>
                  <strong>{p.name}</strong>
                  <span className="muted small">
                    {p.width}×{p.height} · {p.fps} fps · {p.scenes} scene{p.scenes === 1 ? '' : 's'} · {p.duration.toFixed(1)} s
                  </span>
                  <span className="muted small">Edited {new Date(p.updatedAt).toLocaleString()}</span>
                </button>
                <button
                  className="icon-btn danger"
                  aria-label={`Delete project ${p.name}`}
                  onClick={async () => {
                    if (!window.confirm(`Delete "${p.name}" and its renders? This cannot be undone.`)) return;
                    await api.deleteProject(p.id).catch((e: Error) => setError(e.message));
                    void load();
                  }}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
