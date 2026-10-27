/**
 * Spike C: a remote MCP server (Streamable HTTP, stateless) that lets the user's own AI edit a
 * reel through typed, validated operations. Hono + the SDK's web-standard transport, so the
 * same code can move to Cloudflare Workers. No auth yet: binds to localhost only.
 *
 *   npx tsx spikes/mcp-server/index.ts         # http://127.0.0.1:8790/mcp
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { Hono } from 'hono';
import { z } from 'zod';
import { parseWords, syntheticWords } from '../shared/words';
import { renderPreview } from './preview';
import { applyOps, CALLOUT_TEMPLATES, CAPTION_STYLES, createReel, keptDuration, lintReel, OpSchema, silenceCuts, type Reel } from './reel';

const PORT = Number(process.env.MCP_PORT ?? 8790);
const FIXTURES = path.resolve(import.meta.dirname, '../../.tmp/fixtures');

interface Entry {
  reel: Reel;
  /** Earlier versions, newest last; each apply_ops / autopilot run pushes one. */
  history: Reel[];
}

/** In-memory projects. One demo reel, built from the spike fixtures when they exist. */
export function createStore(): Map<string, Entry> {
  const footage = path.join(FIXTURES, 'talking-10min-1080p.mp4');
  const wordsFile = path.join(FIXTURES, 'speech.words.json');
  const words = existsSync(wordsFile) ? parseWords(JSON.parse(readFileSync(wordsFile, 'utf8').replace(/^﻿/, ''))) : syntheticWords(90);
  const duration = existsSync(footage) ? 600 : Math.ceil(words[words.length - 1]!.end + 1);
  const reel = createReel({
    id: 'demo',
    name: 'Coding mistakes (demo footage)',
    source: { file: existsSync(footage) ? footage : null, duration, width: 1920, height: 1080 },
    words,
  });
  return new Map([[reel.id, { reel, history: [] }]]);
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

function outline(reel: Reel) {
  return {
    id: reel.id,
    name: reel.name,
    revision: reel.revision,
    sourceSeconds: reel.source.duration,
    keptSeconds: Number(keptDuration(reel).toFixed(2)),
    output: reel.output,
    words: reel.words.length,
    captions: reel.captions,
    cuts: reel.cuts,
    callouts: reel.callouts,
    zooms: reel.zooms,
  };
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function buildMcpServer(store: Map<string, Entry>): McpServer {
  const server = new McpServer({ name: 'siedits', version: '0.0.1' });
  const get = (id: string) => store.get(id);
  const projectId = z.string().describe('Project id from list_projects');

  server.registerTool(
    'list_projects',
    { title: 'List projects', description: 'List the reels you can edit.', annotations: { title: 'List projects', ...READ } },
    async () => json([...store.values()].map(({ reel }) => ({ id: reel.id, name: reel.name, revision: reel.revision, sourceSeconds: reel.source.duration }))),
  );

  server.registerTool(
    'get_project_outline',
    {
      title: 'Get project outline',
      description: 'Current cuts, callouts, zooms and caption style of a reel, with its revision number.',
      inputSchema: { projectId },
      annotations: { title: 'Get project outline', ...READ },
    },
    async ({ projectId }) => {
      const entry = get(projectId);
      return entry ? json(outline(entry.reel)) : fail(`unknown project "${projectId}"`);
    },
  );

  server.registerTool(
    'get_transcript',
    {
      title: 'Get transcript',
      description:
        'Words with start/end times (seconds on the source clock) between `from` and `to`. Cut edges must not split a word: put them on these boundaries or in the silence between words. At most 400 words per call.',
      inputSchema: { projectId, from: z.number().min(0).default(0), to: z.number().min(0).optional() },
      annotations: { title: 'Get transcript', ...READ },
    },
    async ({ projectId, from, to }) => {
      const entry = get(projectId);
      if (!entry) return fail(`unknown project "${projectId}"`);
      const words = entry.reel.words.filter((w) => w.end > from && (to === undefined || w.start < to));
      const page = words.slice(0, 400);
      return json({
        from,
        to: to ?? entry.reel.source.duration,
        truncated: words.length > page.length,
        nextFrom: words.length > page.length ? page[page.length - 1]!.end : null,
        text: page.map((w) => w.text).join(' '),
        words: page.map((w) => [w.text, w.start, w.end]),
      });
    },
  );

  server.registerTool(
    'list_templates',
    { title: 'List graphic templates', description: 'Callout templates for add_callout, with text and duration limits.', annotations: { title: 'List graphic templates', ...READ } },
    async () => json({ callouts: CALLOUT_TEMPLATES, captionStyles: CAPTION_STYLES, textFormat: 'Use "main | detail" for two-line templates.' }),
  );

  server.registerTool(
    'apply_ops',
    {
      title: 'Apply edit operations',
      description:
        'Apply typed edits (cut, restore, add_callout, update_callout, remove_callout, zoom, remove_zoom, set_caption_style). All ops are validated against the transcript and applied together, or none are; errors say which op failed and why. Pass baseRevision to avoid overwriting edits made since you last read the project. Undo reverts the whole batch.',
      inputSchema: { projectId, baseRevision: z.number().int().min(0).optional(), ops: z.array(OpSchema).min(1).max(50) },
      annotations: { title: 'Apply edit operations', ...WRITE },
    },
    async ({ projectId, baseRevision, ops }) => {
      const entry = get(projectId);
      if (!entry) return fail(`unknown project "${projectId}"`);
      if (baseRevision !== undefined && baseRevision !== entry.reel.revision) {
        return fail(`stale baseRevision ${baseRevision}: project is at revision ${entry.reel.revision}; read it again and retry`);
      }
      const result = applyOps(entry.reel, ops);
      if (!result.ok) return { ...json({ applied: false, errors: result.errors }), isError: true };
      entry.history.push(entry.reel);
      entry.reel = result.reel;
      return json({ applied: true, revision: result.reel.revision, results: result.applied, lint: lintReel(result.reel) });
    },
  );

  server.registerTool(
    'run_autopilot',
    {
      title: 'Run autopilot first cut',
      description: 'Deterministic first pass without AI: cuts pauses longer than 0.6 s and turns on bold captions. Undoable like apply_ops.',
      inputSchema: { projectId },
      annotations: { title: 'Run autopilot first cut', ...WRITE },
    },
    async ({ projectId }) => {
      const entry = get(projectId);
      if (!entry) return fail(`unknown project "${projectId}"`);
      const ops = [
        ...silenceCuts(entry.reel.words).filter((c) => !entry.reel.cuts.some((x) => c.start < x.end && c.end > x.start)).map((c) => ({ op: 'cut', ...c, reason: 'silence' })),
        { op: 'set_caption_style', style: 'bold-pop' },
      ];
      const result = applyOps(entry.reel, ops);
      if (!result.ok) return { ...json({ applied: false, errors: result.errors }), isError: true };
      entry.history.push(entry.reel);
      entry.reel = result.reel;
      return json({ applied: true, revision: result.reel.revision, cutsAdded: ops.length - 1, keptSeconds: Number(keptDuration(result.reel).toFixed(2)) });
    },
  );

  server.registerTool(
    'lint_project',
    {
      title: 'Check quality',
      description: 'Deterministic quality checks (overlaps, hidden callouts, missing hook, static stretches, density). Fix every error before export.',
      inputSchema: { projectId },
      annotations: { title: 'Check quality', ...READ },
    },
    async ({ projectId }) => {
      const entry = get(projectId);
      return entry ? json({ revision: entry.reel.revision, issues: lintReel(entry.reel) }) : fail(`unknown project "${projectId}"`);
    },
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo last change',
      description: 'Revert the most recent apply_ops or run_autopilot batch.',
      inputSchema: { projectId },
      annotations: { title: 'Undo last change', ...WRITE },
    },
    async ({ projectId }) => {
      const entry = get(projectId);
      if (!entry) return fail(`unknown project "${projectId}"`);
      const previous = entry.history.pop();
      if (!previous) return fail('nothing to undo');
      // Keep revisions increasing so stale baseRevision checks still work after an undo.
      entry.reel = { ...previous, revision: entry.reel.revision + 1 };
      return json({ undone: true, revision: entry.reel.revision, outline: outline(entry.reel) });
    },
  );

  server.registerTool(
    'render_preview',
    {
      title: 'Render preview frame',
      description: 'Render the edited reel at a source time (seconds) as a PNG, so you can see captions, zooms and graphics.',
      inputSchema: { projectId, time: z.number().min(0), scale: z.number().min(0.1).max(1).default(0.4) },
      annotations: { title: 'Render preview frame', ...READ },
    },
    async ({ projectId, time, scale }) => {
      const entry = get(projectId);
      if (!entry) return fail(`unknown project "${projectId}"`);
      if (time > entry.reel.source.duration) return fail(`time ${time} is past the end (${entry.reel.source.duration} s)`);
      const png = await renderPreview(entry.reel, time, scale);
      const cut = entry.reel.cuts.find((c) => time >= c.start && time < c.end);
      return {
        content: [
          { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' },
          { type: 'text' as const, text: `revision ${entry.reel.revision}, t=${time}s${cut ? ` (inside ${cut.id}: this moment is cut from the reel)` : ''}` },
        ],
      };
    },
  );

  return server;
}

export function createApp(store = createStore()): Hono {
  const app = new Hono();
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  app.all('/mcp', async (c) => {
    // Stateless: a fresh server + transport per request, sharing the store.
    const server = buildMcpServer(store);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  });
  app.get('/', (c) => c.text('SIEdits MCP spike: POST /mcp'));
  return app;
}

export function start(): void {
  serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
    console.log(`SIEdits MCP spike on http://127.0.0.1:${info.port}/mcp`);
  });
}
