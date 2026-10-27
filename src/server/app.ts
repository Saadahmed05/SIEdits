/**
 * HTTP API for the editor. JSON in, JSON out; every error has the shape
 * { error: string, code?: string, issues?: {path, message}[] }.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { generateProject, type GenerateDeps } from '../ai/generate';
import type { PlannerProvider } from '../ai/types';
import { FONT_FACES } from '../engine/fonts';
import { isBundle, packBundle, unpackBundle } from '../project/bundle';
import { newId } from '../project/ids';
import { loadProject } from '../project/migrate';
import { SettingsSchema, toIssues } from '../project/schema';
import { MOOD_STYLES } from '../storyboard/moods';
import { TEMPLATES } from '../storyboard/templates';
import { RenderError } from '../render/errors';
import { fontFilePath } from '../render/node-env';
import type { RenderQueue } from './jobs';
import { ProjectStore, StorageError, writeBundleAssets } from './storage';

export interface AppDeps {
  store: ProjectStore;
  queue: RenderQueue;
  providers: PlannerProvider[];
  ffmpegVersion: () => Promise<string | null>;
  maxUploadBytes: number;
  staticDir?: string | null;
  /** Override for tests. */
  generateDeps?: Partial<GenerateDeps>;
}

const GenerateBody = z.strictObject({
  name: z.string().trim().max(120).optional(),
  brief: z.string().max(4000).default(''),
  templateId: z.string().max(64).default('product-launch'),
  settings: SettingsSchema,
  targetDuration: z.number().min(2).max(120).default(12),
  provider: z.string().max(64).default('auto'),
});

function errorResponse(c: Context, err: unknown) {
  if (err instanceof StorageError) return c.json({ error: err.message, issues: err.issues }, err.status);
  if (err instanceof RenderError) {
    const status = err.code === 'FFMPEG_NOT_FOUND' ? 503 : 422;
    return c.json({ error: err.message, code: err.code, issues: err.issues }, status);
  }
  if (err instanceof z.ZodError) return c.json({ error: 'invalid request', issues: toIssues(err) }, 400);
  if (err instanceof SyntaxError) return c.json({ error: `invalid JSON: ${err.message}` }, 400);
  console.error('[api] unexpected error', err);
  return c.json({ error: 'internal error' }, 500);
}

async function jsonBody(c: Context): Promise<unknown> {
  const text = await c.req.text();
  return JSON.parse(text);
}

export function createApp(deps: AppDeps): Hono {
  const { store, queue } = deps;
  const app = new Hono();
  app.onError((err, c) => errorResponse(c, err));

  const generateDeps = (): GenerateDeps => ({
    providers: deps.providers,
    newId: () => newId('proj'),
    now: () => new Date().toISOString(),
    ...deps.generateDeps,
  });

  app.get('/api/health', async (c) =>
    c.json({
      ok: true,
      ffmpeg: await deps.ffmpegVersion(),
      providers: deps.providers.map((p) => ({ id: p.id, label: p.label, configured: p.isConfigured() })),
    }),
  );

  app.get('/api/templates', (c) =>
    c.json({
      templates: TEMPLATES,
      moods: Object.entries(MOOD_STYLES).map(([id, m]) => ({ id, label: m.label, brand: m.brand })),
    }),
  );

  // ---- Projects ---------------------------------------------------------------------------
  app.get('/api/projects', async (c) => c.json({ projects: await store.list() }));

  app.post('/api/projects', async (c) => {
    const body = GenerateBody.parse(await jsonBody(c));
    const { project, report } = await generateProject(body, generateDeps());
    const saved = await store.save(project, { touch: false });
    return c.json({ project: saved, report }, 201);
  });

  app.get('/api/projects/:id', async (c) => c.json({ project: await store.get(c.req.param('id')) }));

  app.put('/api/projects/:id', async (c) => {
    const body = await jsonBody(c);
    const id = c.req.param('id');
    if ((body as { id?: unknown })?.id !== id) return c.json({ error: 'project id in body does not match URL' }, 400);
    return c.json({ project: await store.save(body, { mustExist: true }) });
  });

  app.delete('/api/projects/:id', async (c) => {
    await store.delete(c.req.param('id'));
    return c.body(null, 204);
  });

  /** Re-plan an existing project from a new brief. Keeps id, name, assets; replaces scenes and brand. */
  app.post('/api/projects/:id/generate', async (c) => {
    const current = await store.get(c.req.param('id'));
    const body = GenerateBody.parse({ settings: current.settings, ...(await jsonBody(c) as object) });
    const { project, report } = await generateProject(body, generateDeps());
    const merged = { ...project, id: current.id, name: body.name || current.name, createdAt: current.createdAt, assets: current.assets };
    return c.json({ project: await store.save(merged), report });
  });

  // ---- Import / export ----------------------------------------------------------------------
  app.get('/api/projects/:id/export', async (c) => {
    const project = await store.get(c.req.param('id'));
    const files = await Promise.all(
      project.assets.map((a) => store.readAssetFile(project.id, a.file).catch(() => null)),
    );
    const bundle = packBundle(project, files.filter((f) => f !== null));
    const filename = `${project.name.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'project'}.scenewright.json`;
    c.header('content-disposition', `attachment; filename="${filename}"`);
    return c.json(bundle);
  });

  /** Accepts a bundle (with assets) or a plain project file. Always creates a new project id. */
  app.post('/api/import', async (c) => {
    const body = await jsonBody(c);
    const id = newId('proj');
    const now = new Date().toISOString();
    if (isBundle(body)) {
      const unpacked = unpackBundle(body);
      if (!unpacked.ok) return c.json({ error: 'invalid bundle', issues: unpacked.issues }, 422);
      const saved = await store.save({ ...unpacked.project, id, createdAt: now, updatedAt: now }, { touch: false });
      await writeBundleAssets(store.assetsDir(id), unpacked.files);
      return c.json({ project: saved }, 201);
    }
    const parsed = loadProject(body);
    if (!parsed.ok) return c.json({ error: 'invalid project file', issues: parsed.issues }, 422);
    const saved = await store.save({ ...parsed.value, id, createdAt: now, updatedAt: now }, { touch: false });
    return c.json({ project: saved, warning: parsed.value.assets.length ? 'Plain project files do not include asset files; re-upload images or import a bundle.' : undefined }, 201);
  });

  // ---- Assets -------------------------------------------------------------------------------
  app.post('/api/projects/:id/assets', async (c) => {
    const len = Number(c.req.header('content-length') ?? 0);
    if (len > deps.maxUploadBytes) return c.json({ error: `file is larger than ${deps.maxUploadBytes} bytes` }, 413);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > deps.maxUploadBytes) return c.json({ error: `file is larger than ${deps.maxUploadBytes} bytes` }, 413);
    if (data.byteLength === 0) return c.json({ error: 'empty upload' }, 400);
    const name = decodeURIComponent(c.req.header('x-filename') ?? 'image');
    return c.json({ asset: await store.addAsset(c.req.param('id'), name, data) }, 201);
  });

  app.get('/api/projects/:id/assets/:file', async (c) => {
    const { data, file } = await store.readAssetFile(c.req.param('id'), c.req.param('file'));
    const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return c.body(data as Uint8Array<ArrayBuffer>, 200, { 'content-type': type, 'cache-control': 'private, max-age=3600' });
  });

  // ---- Renders ------------------------------------------------------------------------------
  app.post('/api/projects/:id/renders', async (c) => {
    const id = c.req.param('id');
    const project = await store.get(id);
    const job = queue.enqueue(project, store.assetsDir(id), store.rendersDir(id));
    return c.json({ job }, 202);
  });

  app.get('/api/projects/:id/renders', async (c) => {
    const id = c.req.param('id');
    return c.json({ jobs: queue.list(id), files: await store.listRenders(id) });
  });

  app.get('/api/renders/:jobId', (c) => {
    const job = queue.get(c.req.param('jobId'));
    return job ? c.json({ job }) : c.json({ error: 'render job not found' }, 404);
  });

  app.post('/api/renders/:jobId/cancel', (c) => {
    const job = queue.cancel(c.req.param('jobId'));
    return job ? c.json({ job }) : c.json({ error: 'render job not found' }, 404);
  });

  app.get(
    '/media/renders/:projectId/:file',
    async (c, next) => {
      store.renderFilePath(c.req.param('projectId'), c.req.param('file')); // validates both segments
      return next();
    },
    serveStatic({
      root: path.relative(process.cwd(), store.rendersRoot) || '.',
      rewriteRequestPath: (p) => p.replace(/^\/media\/renders/, ''),
    }),
  );

  // ---- Fonts (the same files the exporter uses) -------------------------------------------------
  app.get('/fonts/:pkg/:file', async (c) => {
    const face = FONT_FACES.find((f) => f.pkg === c.req.param('pkg') && f.file === c.req.param('file'));
    if (!face) return c.json({ error: 'unknown font' }, 404);
    const data = await readFile(fontFilePath(face.pkg, face.file));
    return c.body(new Uint8Array(data), 200, { 'content-type': 'font/woff2', 'cache-control': 'public, max-age=31536000, immutable' });
  });

  // ---- Built editor (production) ----------------------------------------------------------------
  if (deps.staticDir) {
    const root = path.relative(process.cwd(), deps.staticDir) || '.';
    app.use('/*', serveStatic({ root }));
    app.get('*', serveStatic({ root, path: 'index.html' }));
  }

  return app;
}
