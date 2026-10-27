import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { heuristicProvider } from '../src/ai/heuristic';
import type { Project } from '../src/project/schema';
import { ffmpegVersion } from '../src/render/ffmpeg';
import { createApp } from '../src/server/app';
import { RenderQueue, type RenderJob } from '../src/server/jobs';
import { ProjectStore } from '../src/server/storage';
import { tinyPng } from './fixtures';

let app: ReturnType<typeof createApp>;
let queue: RenderQueue;

beforeEach(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sw-api-'));
  queue = new RenderQueue();
  app = createApp({ store: new ProjectStore(dir), queue, providers: [heuristicProvider], ffmpegVersion: () => ffmpegVersion(), maxUploadBytes: 1024 * 1024 });
});

const json = (method: string, body?: unknown, headers: Record<string, string> = {}) => ({
  method,
  headers: { 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function create(): Promise<Project> {
  const res = await app.request(
    '/api/projects',
    json('POST', { name: 'API test', brief: 'A 4-second launch for Nova with a logo', templateId: 'product-launch', settings: { width: 320, height: 180, fps: 10 }, targetDuration: 4 }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { project: Project }).project;
}

describe('HTTP API', () => {
  it('reports health and templates', async () => {
    const health = (await (await app.request('/api/health')).json()) as { ffmpeg: string | null; providers: unknown[] };
    expect(health.ffmpeg).toMatch(/ffmpeg version/);
    expect(health.providers).toHaveLength(1);
    const t = (await (await app.request('/api/templates')).json()) as { templates: unknown[] };
    expect(t.templates.length).toBeGreaterThanOrEqual(4);
  });

  it('creates, lists, updates and deletes projects', async () => {
    const project = await create();
    const list = (await (await app.request('/api/projects')).json()) as { projects: Array<{ id: string }> };
    expect(list.projects.map((p) => p.id)).toEqual([project.id]);

    const renamed = { ...project, name: 'Renamed' };
    const put = await app.request(`/api/projects/${project.id}`, json('PUT', renamed));
    expect(put.status).toBe(200);
    expect(((await (await app.request(`/api/projects/${project.id}`)).json()) as { project: Project }).project.name).toBe('Renamed');

    expect((await app.request(`/api/projects/${project.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/api/projects/${project.id}`)).status).toBe(404);
  });

  it('rejects invalid saves with field-level issues and keeps the stored project', async () => {
    const project = await create();
    const bad = { ...project, scenes: [{ ...project.scenes[0]!, duration: -1 }] };
    const res = await app.request(`/api/projects/${project.id}`, json('PUT', bad));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { issues: Array<{ path: string }> };
    expect(body.issues.some((i) => i.path === 'scenes[0].duration')).toBe(true);
    expect((await app.request(`/api/projects/${project.id}`)).status).toBe(200);
  });

  it('rejects malformed requests and unsafe ids', async () => {
    expect((await app.request('/api/projects', json('POST', { settings: { width: 0 } }))).status).toBe(400);
    expect((await app.request('/api/projects', { method: 'POST', body: '{nope', headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await app.request('/api/projects/..%2Fetc')).status).toBe(400);
  });

  it('accepts image uploads, rejects non-images, and serves stored assets', async () => {
    const project = await create();
    const png = await tinyPng();
    const up = await app.request(`/api/projects/${project.id}/assets`, { method: 'POST', body: new Uint8Array(png), headers: { 'x-filename': 'logo.png' } });
    expect(up.status).toBe(201);
    const { asset } = (await up.json()) as { asset: { file: string; width: number } };
    expect(asset.width).toBe(4);
    const get = await app.request(`/api/projects/${project.id}/assets/${asset.file}`);
    expect(get.headers.get('content-type')).toBe('image/png');
    const svg = await app.request(`/api/projects/${project.id}/assets`, { method: 'POST', body: '<svg/>', headers: { 'x-filename': 'x.svg' } });
    expect(svg.status).toBe(400);
  });

  it('exports a bundle and imports it as a new project with its assets', async () => {
    const project = await create();
    const up = await app.request(`/api/projects/${project.id}/assets`, { method: 'POST', body: new Uint8Array(await tinyPng()), headers: { 'x-filename': 'shot.png' } });
    const { asset } = (await up.json()) as { asset: Project['assets'][number] };
    const withAsset = { ...project, assets: [asset] };
    withAsset.scenes[0]!.elements.push({ id: 'dev', type: 'device', frame: 'browser', assetId: asset.id, width: 0.5, accent: '@primary', shadow: true, x: 0.5, y: 0.5, rotation: 0, scale: 1, opacity: 1, start: 0, end: null, animations: [] });
    expect((await app.request(`/api/projects/${project.id}`, json('PUT', withAsset))).status).toBe(200);

    const bundle = await (await app.request(`/api/projects/${project.id}/export`)).json();
    const imported = await app.request('/api/import', json('POST', bundle));
    expect(imported.status).toBe(201);
    const copy = ((await imported.json()) as { project: Project }).project;
    expect(copy.id).not.toBe(project.id);
    expect(copy.scenes).toEqual(withAsset.scenes);
    expect((await app.request(`/api/projects/${copy.id}/assets/${asset.file}`)).status).toBe(200);

    const invalid = await app.request('/api/import', json('POST', { format: 'scenewright.project', version: 7 }));
    expect(invalid.status).toBe(422);
  });

  it('renders via the job queue and serves the verified video with range support', async () => {
    const project = await create();
    const start = await app.request(`/api/projects/${project.id}/renders`, { method: 'POST' });
    expect(start.status).toBe(202);
    const { job } = (await start.json()) as { job: RenderJob };
    await queue.idle();
    const done = ((await (await app.request(`/api/renders/${job.id}`)).json()) as { job: RenderJob }).job;
    expect(done.state).toBe('done');
    expect(done.output!.probe).toMatchObject({ width: 320, height: 180, codec: 'h264' });

    const full = await app.request(done.output!.url);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toBe('video/mp4');
    const partial = await app.request(done.output!.url, { headers: { range: 'bytes=0-99' } });
    expect(partial.status).toBe(206);
    expect((await partial.arrayBuffer()).byteLength).toBe(100);
    expect((await app.request(`/media/renders/${project.id}/..%2F..%2Fsecret.mp4`)).status).toBe(400);

    const list = (await (await app.request(`/api/projects/${project.id}/renders`)).json()) as { files: unknown[] };
    expect(list.files).toHaveLength(1);
  });

  it('refuses to queue renders for projects with missing assets', async () => {
    const project = await create();
    const broken = {
      ...project,
      assets: [{ id: 'a1', kind: 'image', name: 'x', file: 'a1.png', mimeType: 'image/png', width: 4, height: 4 }],
    } as Project;
    broken.scenes[0]!.elements.push({ id: 'img', type: 'image', assetId: 'a1', width: 0.5, cornerRadius: 0, shadow: false, x: 0.5, y: 0.5, rotation: 0, scale: 1, opacity: 1, start: 0, end: null, animations: [] });
    expect((await app.request(`/api/projects/${project.id}`, json('PUT', broken))).status).toBe(200);
    const res = await app.request(`/api/projects/${project.id}/renders`, { method: 'POST' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe('MISSING_ASSET');
  });
});
