/**
 * Agent round trip against the MCP spike, using the official SDK client the way Claude would:
 * discover tools, read the transcript, apply edits, get a rejection, lint, look at a frame, undo.
 *
 *   npx tsx spikes/mcp-server/index.ts &      # start the server
 *   npx tsx spikes/mcp-server/smoke.ts [url]  # default http://127.0.0.1:8790/mcp
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8790/mcp');
const outDir = path.resolve(import.meta.dirname, '../../.tmp');
const checks: { name: string; pass: boolean; detail?: string }[] = [];
const check = (name: string, pass: boolean, detail?: string) => checks.push({ name, pass, detail });

type Content = { type: string; text?: string; data?: string; mimeType?: string }[];

const client = new Client({ name: 'siedits-smoke', version: '0.0.1' });
await client.connect(new StreamableHTTPClientTransport(url));

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as { content: Content; isError?: boolean };
  const text = res.content.find((c) => c.type === 'text')?.text ?? '';
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    // plain-text message
  }
  return { ...res, data };
}

const { tools } = await client.listTools();
check(
  'every tool has a title and read/destructive hints (Claude directory requirement)',
  tools.every((t) => t.annotations?.title && typeof t.annotations.readOnlyHint === 'boolean' && typeof t.annotations.destructiveHint === 'boolean'),
  tools.map((t) => t.name).join(', '),
);

const projects = (await call('list_projects')).data as { id: string }[];
const projectId = projects[0]!.id;
check('list_projects returns a project', !!projectId, projectId);

const transcript = (await call('get_transcript', { projectId, from: 0, to: 20 })).data as { words: [string, number, number][]; text: string };
const words = transcript.words;
check('get_transcript returns timed words', words.length > 10, transcript.text.slice(0, 80));

// What an agent would do after reading the transcript: hook, cut a sentence, zoom, stat card.
const sentenceStart = words.findIndex((w) => /^mistake$/i.test(w[0]));
const sentenceEnd = words.findIndex((w, i) => i > sentenceStart && /^time/i.test(w[0]));
const outline0 = (await call('get_project_outline', { projectId })).data as { revision: number };
const ops = [
  { op: 'add_callout', template: 'hook-title', text: '3 coding mistakes', start: words[0]![1], end: words[0]![1] + 2.5 },
  { op: 'cut', start: words[sentenceStart]![1], end: words[sentenceEnd]![2], reason: 'tangent' },
  { op: 'zoom', start: words[sentenceEnd + 1]![1], end: words[sentenceEnd + 1]![1] + 3, scale: 1.2 },
  { op: 'add_callout', template: 'list-item', text: 'Pick ONE language', start: words[sentenceEnd + 1]![1], end: words[sentenceEnd + 1]![1] + 3 },
];
const applied = await call('apply_ops', { projectId, baseRevision: outline0.revision, ops });
check('apply_ops applies a valid batch', !applied.isError, JSON.stringify((applied.data as { results?: unknown }).results));

const midWord = (words[3]![1] + words[3]![2]) / 2;
const rejected = await call('apply_ops', { projectId, ops: [{ op: 'cut', start: midWord, end: words[6]![2] }, { op: 'add_callout', template: 'stat-card', text: 'x'.repeat(60), start: 30, end: 33 }] });
check(
  'apply_ops rejects a mid-word cut and over-long text with reasons',
  !!rejected.isError && JSON.stringify(rejected.data).includes('splits the word') && JSON.stringify(rejected.data).includes('fits at most'),
  JSON.stringify((rejected.data as { errors?: unknown }).errors),
);

const stale = await call('apply_ops', { projectId, baseRevision: outline0.revision, ops: [{ op: 'set_caption_style', style: 'clean' }] });
check('apply_ops refuses a stale baseRevision', !!stale.isError, String(stale.data));

const lint = (await call('lint_project', { projectId })).data as { issues: { code: string }[] };
check('lint_project runs', Array.isArray(lint.issues), lint.issues.map((i) => i.code).join(', ') || 'no issues');

const preview = await call('render_preview', { projectId, time: 1.2, scale: 0.4 });
const image = preview.content.find((c) => c.type === 'image');
if (image?.data) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, 'spike-c-preview.png'), Buffer.from(image.data, 'base64'));
}
check('render_preview returns a PNG', image?.mimeType === 'image/png' && (image.data?.length ?? 0) > 1000, `${Math.round((image?.data?.length ?? 0) * 0.75 / 1024)} kB → .tmp/spike-c-preview.png`);

const undo = (await call('undo', { projectId })).data as { outline: { callouts: unknown[]; cuts: unknown[] } };
check('undo reverts the whole batch', undo.outline.callouts.length === 0 && undo.outline.cuts.length === 0);

await client.close();
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `\n      ${c.detail}` : ''}`);
const failed = checks.filter((c) => !c.pass).length;
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
