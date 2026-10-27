import { useEffect, useRef, useState } from 'react';
import type { GenerationReport } from '../../ai/generate';
import { totalDuration } from '../../engine/timeline';
import { addAsset, removeAsset, updateBrand } from '../../project/edit';
import { contrastRatio } from '../../project/colors';
import { BRAND_TOKENS, FONT_FAMILIES, type Project } from '../../project/schema';
import { MOOD_STYLES } from '../../storyboard/moods';
import type { RenderJob } from '../../server/jobs';
import { api, ApiError, type Health } from '../api';
import { NumberField, Section, SelectField, TextField } from './fields';

type Edit = (fn: (p: Project) => Project, key?: string) => void;

// ---------------------------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------------------------

export function BrandPanel({ project, edit }: { project: Project; edit: Edit }) {
  const { brand } = project;
  const contrast = contrastRatio(brand.text, brand.background);
  return (
    <>
      <Section title="Brand colors">
        <p className="muted small">Layers that use brand colors update everywhere when you change them here.</p>
        {BRAND_TOKENS.map((token) => (
          <div className="field" key={token}>
            <span className="field-label">{token[0]!.toUpperCase() + token.slice(1)}</span>
            <div className="field-control color-field">
              <input
                type="color"
                aria-label={`Brand ${token} color`}
                value={brand[token].slice(0, 7)}
                onChange={(e) => edit((p) => updateBrand(p, { [token]: e.target.value }), `brand-${token}`)}
              />
              <input
                type="text"
                aria-label={`Brand ${token} hex`}
                value={brand[token]}
                onChange={(e) => {
                  if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) edit((p) => updateBrand(p, { [token]: e.target.value.toLowerCase() }), `brand-${token}`);
                }}
              />
            </div>
          </div>
        ))}
        {contrast < 4.5 && (
          <p className="warning small" role="status">
            Text/background contrast is {contrast.toFixed(1)}:1 — below the 4.5:1 readability guideline.
          </p>
        )}
      </Section>
      <Section title="Typography">
        <SelectField label="Heading font" value={brand.headingFont} options={FONT_FAMILIES} onChange={(headingFont) => edit((p) => updateBrand(p, { headingFont }))} />
        <SelectField label="Body font" value={brand.bodyFont} options={FONT_FAMILIES} onChange={(bodyFont) => edit((p) => updateBrand(p, { bodyFont }))} />
      </Section>
      <Section title="Palette presets">
        <div className="preset-grid">
          {Object.entries(MOOD_STYLES).map(([id, m]) => (
            <button
              key={id}
              className="preset"
              onClick={() => edit((p) => updateBrand(p, m.brand))}
              title={`Apply ${m.label} colors and fonts`}
            >
              <span className="swatches">
                {(['background', 'primary', 'secondary', 'accent'] as const).map((k) => (
                  <i key={k} style={{ background: m.brand[k] }} />
                ))}
              </span>
              {m.label}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

export function AssetsPanel({ project, edit }: { project: Project; edit: Edit }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const { asset } = await api.uploadAsset(project.id, file);
        edit((p) => addAsset(p, asset));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  return (
    <Section
      title="Images"
      actions={
        <button className="btn small" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      }
    >
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden aria-label="Upload images" onChange={(e) => upload(e.target.files)} />
      <p className="muted small">PNG, JPEG or WebP. Use them as product screenshots (Screenshot layer), logos (Logo layer) or Image layers.</p>
      {error && <p className="error small">{error}</p>}
      <ul className="asset-list">
        {project.assets.map((a) => (
          <li key={a.id}>
            <img src={api.assetUrl(project.id, a.file)} alt={a.name} />
            <span>
              {a.name}
              <span className="muted small">
                {' '}
                {a.width}×{a.height}
              </span>
            </span>
            <button className="icon-btn danger" aria-label={`Remove ${a.name}`} onClick={() => edit((p) => removeAsset(p, a.id))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Brief / AI
// ---------------------------------------------------------------------------------------------

export function ReportView({ report }: { report: GenerationReport | Project['generation'] | null }) {
  if (!report) return null;
  const planner = 'plannerLabel' in report ? report.plannerLabel : report.planner;
  const fallback = 'fallbackReason' in report ? report.fallbackReason : undefined;
  const warnings = report.warnings ?? [];
  return (
    <div className="report">
      <p className="small">
        Planned by <strong>{planner}</strong>
        {report.model ? ` · ${report.model}` : ''}
      </p>
      {fallback && <p className="warning small">{fallback}</p>}
      {warnings.filter((w) => w !== fallback).map((w, i) => (
        <p key={i} className="note small">
          {w}
        </p>
      ))}
      {report.unsupported.length > 0 && (
        <>
          <p className="small strong">Not supported yet:</p>
          <ul className="small unsupported">
            {report.unsupported.map((u, i) => (
              <li key={i}>{u}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function BriefPanel({ project, health, onRegenerated, lastReport }: { project: Project; health: Health | null; onRegenerated: (p: Project, r: GenerationReport) => void; lastReport: GenerationReport | null }) {
  const gen = project.generation;
  const [brief, setBrief] = useState(gen?.brief ?? '');
  const [provider, setProvider] = useState('auto');
  const [target, setTarget] = useState(Math.round(totalDuration(project.scenes)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const regenerate = async () => {
    if (!window.confirm('Regenerate replaces all scenes and brand colors (uploaded images are kept). You can undo afterwards. Continue?')) return;
    setBusy(true);
    setError(null);
    try {
      const { project: p, report } = await api.regenerate(project.id, { brief, templateId: gen?.template ?? 'product-launch', targetDuration: target, provider });
      onRegenerated(p, report);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section title="Brief">
        <TextField label="Brief" multiline value={brief} maxLength={4000} onChange={setBrief} />
        <NumberField label="Length" value={target} min={2} max={120} step={1} unit="s" onChange={setTarget} />
        <SelectField
          label="Planner"
          value={provider}
          options={[
            { value: 'auto', label: 'Auto (AI if configured)' },
            ...(health?.providers ?? []).map((p) => ({ value: p.id, label: `${p.label}${p.configured ? '' : ' — not configured'}` })),
          ]}
          onChange={setProvider}
        />
        <button className="btn primary block" disabled={busy} onClick={regenerate}>
          {busy ? 'Planning…' : 'Regenerate scenes from brief'}
        </button>
        {error && <p className="error small">{error}</p>}
      </Section>
      <Section title="Last generation">
        <ReportView report={lastReport ?? gen ?? null} />
        {!gen && !lastReport && <p className="muted small">This project was not generated from a brief.</p>}
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Render & export
// ---------------------------------------------------------------------------------------------

function formatBytes(n: number): string {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

export function RenderPanel({ project, health, flush, issues, startSignal }: { project: Project; health: Health | null; flush: () => Promise<boolean>; issues: number; startSignal: number }) {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [files, setFiles] = useState<Array<{ file: string; size: number; createdAt: string }>>([]);
  const [error, setError] = useState<{ message: string; issues: Array<{ path: string; message: string }> } | null>(null);
  const active = jobs.find((j) => j.state === 'queued' || j.state === 'rendering');

  const refresh = async () => {
    const r = await api.listRenders(project.id);
    setJobs(r.jobs);
    setFiles(r.files);
  };
  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  useEffect(() => {
    if (!active) return;
    const h = window.setInterval(() => refresh().catch(() => {}), 400);
    return () => window.clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const start = async () => {
    setError(null);
    if (!(await flush())) {
      setError({ message: 'Fix the project issues before rendering.', issues: [] });
      return;
    }
    try {
      await api.startRender(project.id);
      await refresh();
    } catch (err) {
      const e = err as ApiError;
      setError({ message: e.message, issues: e.issues ?? [] });
    }
  };
  // The top-bar Render button increments startSignal.
  const lastSignal = useRef(startSignal);
  useEffect(() => {
    if (startSignal !== lastSignal.current) {
      lastSignal.current = startSignal;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startSignal]);

  const latestDone = jobs.find((j) => j.state === 'done');
  const duration = totalDuration(project.scenes);
  const frames = Math.round(duration * project.settings.fps);

  return (
    <>
      <Section title="Render video">
        <p className="muted small">
          H.264 MP4 · {project.settings.width}×{project.settings.height} · {project.settings.fps} fps · {duration.toFixed(2)} s ({frames} frames)
        </p>
        {!health?.ffmpeg && health && <p className="error small">FFmpeg was not found on the server. Install FFmpeg to render.</p>}
        <button className="btn primary block" onClick={start} disabled={Boolean(active) || issues > 0 || !health?.ffmpeg}>
          {active ? 'Rendering…' : 'Render MP4'}
        </button>
        {error && (
          <div className="error small" role="alert">
            {error.message}
            {error.issues.length > 0 && (
              <ul>
                {error.issues.map((i, k) => (
                  <li key={k}>
                    <code>{i.path}</code>: {i.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {active && (
          <div className="progress" data-testid="render-progress">
            <div className="progress-bar">
              <div style={{ width: `${active.totalFrames ? (active.frame / active.totalFrames) * 100 : 0}%` }} />
            </div>
            <div className="progress-meta small">
              <span>
                {active.phase} {active.frame}/{active.totalFrames || '…'}
              </span>
              <button className="link" onClick={() => api.cancelRender(active.id).then(refresh)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {latestDone?.output && (
          <div className="render-result" data-testid="render-result">
            <video src={latestDone.output.url} controls preload="metadata" />
            <p className="small">
              ✓ Verified: {latestDone.output.probe.width}×{latestDone.output.probe.height}, {latestDone.output.probe.frames} frames, {latestDone.output.probe.duration.toFixed(2)} s · rendered in{' '}
              {(latestDone.output.elapsedMs / 1000).toFixed(1)} s
            </p>
            <a className="btn block" href={latestDone.output.url} download={`${project.name}.mp4`}>
              Download MP4
            </a>
          </div>
        )}
        {jobs
          .filter((j) => j.state === 'failed' || j.state === 'cancelled')
          .slice(0, 3)
          .map((j) => (
            <p key={j.id} className={`small ${j.state === 'failed' ? 'error' : 'muted'}`}>
              {j.state === 'failed' ? 'Failed' : 'Cancelled'}: {j.error?.message}
            </p>
          ))}
      </Section>
      <Section title="Previous renders">
        {files.length === 0 && <p className="muted small">None yet.</p>}
        <ul className="file-list small">
          {files.map((f) => (
            <li key={f.file}>
              <a href={`/media/renders/${project.id}/${f.file}`} target="_blank" rel="noreferrer">
                {new Date(f.createdAt).toLocaleString()}
              </a>{' '}
              <span className="muted">{formatBytes(f.size)}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Project file">
        <p className="muted small">The bundle contains the editable project and its images, so it can be re-imported and re-rendered anywhere.</p>
        <a className="btn block" href={api.exportUrl(project.id)} download>
          Export project bundle (.scenewright.json)
        </a>
      </Section>
    </>
  );
}
