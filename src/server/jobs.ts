/**
 * In-process render queue. Jobs run one at a time (rendering is CPU-bound); each job renders a
 * snapshot of the project taken when it was queued, so edits made during a render do not
 * affect it. State lives in memory; finished videos live on disk.
 */
import path from 'node:path';
import { newId } from '../project/ids';
import type { Project, ValidationIssue } from '../project/schema';
import { RenderError, type RenderErrorCode } from '../render/errors';
import type { ProbeResult } from '../render/ffmpeg';
import { renderVideo, validateForRender, type RenderOptions, type RenderResult } from '../render/render-video';

export type JobState = 'queued' | 'rendering' | 'done' | 'failed' | 'cancelled';

export interface RenderJob {
  id: string;
  projectId: string;
  projectName: string;
  state: JobState;
  phase: 'queued' | 'preparing' | 'rendering' | 'verifying' | 'finished';
  frame: number;
  totalFrames: number;
  createdAt: string;
  finishedAt?: string;
  error?: { code: RenderErrorCode | 'INTERNAL'; message: string; issues: ValidationIssue[] };
  output?: { file: string; url: string; probe: ProbeResult; elapsedMs: number };
}

type Renderer = (project: Project, options: RenderOptions) => Promise<RenderResult>;

interface Entry {
  job: RenderJob;
  project: Project;
  assetsDir: string;
  outputDir: string;
  controller: AbortController;
}

const MAX_JOBS_KEPT = 100;

export class RenderQueue {
  private entries = new Map<string, Entry>();
  private pending: Entry[] = [];
  private running = false;

  constructor(private readonly renderer: Renderer = renderVideo) {}

  /** Validates synchronously (throws RenderError) so obvious problems are reported before queueing. */
  enqueue(project: Project, assetsDir: string, outputDir: string): RenderJob {
    validateForRender(project, assetsDir);
    const job: RenderJob = {
      id: newId('render'),
      projectId: project.id,
      projectName: project.name,
      state: 'queued',
      phase: 'queued',
      frame: 0,
      totalFrames: 0,
      createdAt: new Date().toISOString(),
    };
    const entry: Entry = { job, project: structuredClone(project), assetsDir, outputDir, controller: new AbortController() };
    this.entries.set(job.id, entry);
    this.pending.push(entry);
    this.prune();
    void this.drain();
    return { ...job };
  }

  get(id: string): RenderJob | undefined {
    const e = this.entries.get(id);
    return e ? { ...e.job } : undefined;
  }

  list(projectId?: string): RenderJob[] {
    return [...this.entries.values()]
      .map((e) => ({ ...e.job }))
      .filter((j) => !projectId || j.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  cancel(id: string): RenderJob | undefined {
    const e = this.entries.get(id);
    if (!e) return undefined;
    if (e.job.state === 'queued') {
      this.pending = this.pending.filter((p) => p !== e);
      this.finish(e, 'cancelled', { code: 'CANCELLED', message: 'Render cancelled.', issues: [] });
    } else if (e.job.state === 'rendering') {
      e.controller.abort();
    }
    return { ...e.job };
  }

  /** Resolves when no job is queued or running (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    while (this.running || this.pending.length) await new Promise((r) => setTimeout(r, 20));
  }

  private finish(e: Entry, state: JobState, error?: RenderJob['error']): void {
    e.job.state = state;
    e.job.phase = 'finished';
    e.job.finishedAt = new Date().toISOString();
    if (error) e.job.error = error;
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let e: Entry | undefined;
      while ((e = this.pending.shift())) await this.run(e);
    } finally {
      this.running = false;
    }
  }

  private async run(e: Entry): Promise<void> {
    e.job.state = 'rendering';
    e.job.phase = 'preparing';
    const file = `${e.job.id}.mp4`;
    try {
      const result = await this.renderer(e.project, {
        assetsDir: e.assetsDir,
        output: path.join(e.outputDir, file),
        signal: e.controller.signal,
        onProgress: (p) => {
          e.job.phase = p.phase;
          e.job.frame = p.frame;
          e.job.totalFrames = p.totalFrames;
        },
      });
      e.job.output = {
        file,
        url: `/media/renders/${e.project.id}/${file}`,
        probe: result.probe,
        elapsedMs: result.elapsedMs,
      };
      this.finish(e, 'done');
    } catch (err) {
      if (err instanceof RenderError) {
        this.finish(e, err.code === 'CANCELLED' ? 'cancelled' : 'failed', { code: err.code, message: err.message, issues: err.issues });
      } else {
        console.error('[render] unexpected error', err);
        this.finish(e, 'failed', { code: 'INTERNAL', message: (err as Error).message ?? String(err), issues: [] });
      }
    }
  }

  private prune(): void {
    const finished = [...this.entries.values()].filter((e) => e.job.state !== 'queued' && e.job.state !== 'rendering');
    const excess = this.entries.size - MAX_JOBS_KEPT;
    for (const e of finished.slice(0, Math.max(0, excess))) this.entries.delete(e.job.id);
  }
}
