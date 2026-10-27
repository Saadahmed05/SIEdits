import type { GenerationReport } from '../ai/generate';
import type { Asset, Project, Settings, ValidationIssue } from '../project/schema';
import type { Template } from '../storyboard/templates';
import type { RenderJob } from '../server/jobs';
import type { ProjectSummary } from '../server/storage';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: ValidationIssue[] = [],
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined && !(body instanceof Blob) ? { 'content-type': 'application/json', ...headers } : headers,
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(0, `Cannot reach the SceneWright server: ${(err as Error).message}`);
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: ValidationIssue[]; code?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data.issues ?? [], data.code);
  return data as T;
}

export interface Health {
  ok: boolean;
  ffmpeg: string | null;
  providers: Array<{ id: string; label: string; configured: boolean }>;
}

export interface GenerateInput {
  name?: string;
  brief: string;
  templateId: string;
  settings: Settings;
  targetDuration: number;
  provider: string;
}

export const api = {
  health: () => request<Health>('GET', '/api/health'),
  templates: () =>
    request<{ templates: Template[]; moods: Array<{ id: string; label: string; brand: Project['brand'] }> }>('GET', '/api/templates'),
  listProjects: () => request<{ projects: ProjectSummary[] }>('GET', '/api/projects'),
  createProject: (input: GenerateInput) =>
    request<{ project: Project; report: GenerationReport }>('POST', '/api/projects', input),
  getProject: (id: string) => request<{ project: Project }>('GET', `/api/projects/${id}`),
  saveProject: (project: Project) => request<{ project: Project }>('PUT', `/api/projects/${project.id}`, project),
  deleteProject: (id: string) => request<void>('DELETE', `/api/projects/${id}`),
  regenerate: (id: string, input: Omit<GenerateInput, 'settings' | 'name'>) =>
    request<{ project: Project; report: GenerationReport }>('POST', `/api/projects/${id}/generate`, input),
  importProject: (json: unknown) => request<{ project: Project; warning?: string }>('POST', '/api/import', json),
  exportUrl: (id: string) => `/api/projects/${id}/export`,
  uploadAsset: (id: string, file: File) =>
    request<{ asset: Asset }>('POST', `/api/projects/${id}/assets`, file, { 'x-filename': encodeURIComponent(file.name) }),
  assetUrl: (projectId: string, file: string) => `/api/projects/${projectId}/assets/${file}`,
  startRender: (id: string) => request<{ job: RenderJob }>('POST', `/api/projects/${id}/renders`),
  listRenders: (id: string) =>
    request<{ jobs: RenderJob[]; files: Array<{ file: string; size: number; createdAt: string }> }>('GET', `/api/projects/${id}/renders`),
  getRender: (jobId: string) => request<{ job: RenderJob }>('GET', `/api/renders/${jobId}`),
  cancelRender: (jobId: string) => request<{ job: RenderJob }>('POST', `/api/renders/${jobId}/cancel`),
};
