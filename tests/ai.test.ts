import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../src/ai/anthropic';
import { fitDurations, generateProject, selectProvider } from '../src/ai/generate';
import {
  allocateDurations,
  chooseSceneKinds,
  extractDuration,
  extractProductName,
  extractUnsupported,
  heuristicProvider,
  planFromBrief,
} from '../src/ai/heuristic';
import { createOpenAICompatibleProvider } from '../src/ai/openai-compatible';
import { parseJsonObject } from '../src/ai/prompt';
import type { PlannerProvider } from '../src/ai/types';
import { totalDuration } from '../src/engine/timeline';
import { transitionDurationFor } from '../src/storyboard/compile';
import { parseProject } from '../src/project/schema';
import { StoryboardSchema, type Storyboard } from '../src/storyboard/schema';
import { getTemplate } from '../src/storyboard/templates';

const NOVA = getTemplate('product-launch').defaultBrief;
const settings = { width: 1920, height: 1080, fps: 30 };
const deps = (providers: PlannerProvider[]) => ({ providers, newId: () => 'p1', now: () => '2026-01-01T00:00:00.000Z' });
const request = (overrides: Record<string, unknown> = {}) => ({ brief: NOVA, templateId: 'product-launch', settings, targetDuration: 12, ...overrides });

const validBoard: Storyboard = StoryboardSchema.parse({
  title: 'Nova',
  productName: 'Nova',
  tagline: 'Light up your data',
  mood: 'bold-vibrant',
  palette: { primary: '#123456' },
  scenes: [
    { kind: 'title', duration: 4, headline: 'Meet Nova' },
    { kind: 'feature-list', duration: 5, headline: 'Why Nova', items: ['Fast', 'Simple'] },
    { kind: 'logo-reveal', duration: 4, headline: 'Nova' },
  ],
  unsupported: ['3D camera fly-through'],
});

const fakeProvider = (impl: PlannerProvider['plan'], configured = true): PlannerProvider => ({
  id: 'fake',
  label: 'Fake AI',
  isConfigured: () => configured,
  plan: impl,
});

describe('heuristic planner', () => {
  it('extracts name, duration, mood and requested scenes from the Nova brief', () => {
    expect(extractDuration(NOVA)).toBe(12);
    expect(extractProductName(NOVA)).toBe('Nova');
    const { storyboard, warnings } = planFromBrief({ brief: NOVA, template: getTemplate('product-launch'), targetDuration: 30, settings });
    expect(storyboard.mood).toBe('dark-cinematic');
    expect(storyboard.scenes.map((s) => s.kind)).toEqual(['title', 'product-reveal', 'logo-reveal']);
    expect(storyboard.productName).toBe('Nova');
    expect(warnings).toEqual([]);
    expect(StoryboardSchema.safeParse(storyboard).success).toBe(true);
  });

  it('handles names with dots and does not run across sentences', () => {
    expect(extractProductName('A promo for an app called Acme.io. It is fast.')).toBe('Acme.io');
    expect(extractProductName('Launching Orbit Cloud today')).toBe('Orbit Cloud');
    expect(extractProductName('make a nice video')).toBeNull();
  });

  it('adds scenes the brief asks for and respects the duration budget', () => {
    const kinds = chooseSceneKinds('features: speed, privacy. 3x faster. Sign up at nova.dev', ['title', 'product-reveal', 'logo-reveal'], 20);
    expect(kinds).toEqual(['title', 'product-reveal', 'feature-list', 'stat', 'call-to-action', 'logo-reveal']);
    expect(chooseSceneKinds('features and logo', ['title', 'product-reveal', 'logo-reveal'], 5)).toHaveLength(2);
  });

  it('allocates durations whose overlapped total matches the target', () => {
    for (const target of [6, 12, 30]) {
      const d = allocateDurations(['title', 'product-reveal', 'feature-list', 'logo-reveal'], target);
      const overlap = d.slice(1).reduce((acc, x, i) => acc + transitionDurationFor(d[i]!, x), 0);
      expect(d.every((x) => x >= 1)).toBe(true);
      expect(Math.abs(d.reduce((a, b) => a + b, 0) - overlap - target)).toBeLessThan(0.3);
    }
  });

  it('reports unsupported requests instead of silently ignoring them', () => {
    const u = extractUnsupported('A 3D camera fly-through with an epic soundtrack and a voice-over');
    expect(u).toHaveLength(3);
    expect(extractUnsupported(NOVA)).toEqual([]);
  });

  it('labels placeholder copy with warnings', () => {
    const { warnings } = planFromBrief({ brief: 'show some features', template: getTemplate('product-launch'), targetDuration: 12, settings });
    expect(warnings.some((w) => w.includes('No product name'))).toBe(true);
    expect(warnings.some((w) => w.includes('placeholder feature'))).toBe(true);
  });

  it('is deterministic', async () => {
    const a = await generateProject(request(), deps([heuristicProvider]));
    const b = await generateProject(request(), deps([heuristicProvider]));
    expect(a.project).toEqual(b.project);
  });
});

describe('generateProject', () => {
  it('produces a valid, editable multi-scene project near the requested length without AI', async () => {
    for (const templateId of ['product-launch', 'kinetic-typography', 'logo-reveal']) {
      for (const s of [settings, { width: 1080, height: 1920, fps: 30 }]) {
        const brief = getTemplate(templateId).defaultBrief;
        const target = extractDuration(brief) ?? 12;
        const { project, report } = await generateProject(request({ templateId, brief, settings: s, targetDuration: target }), deps([heuristicProvider]));
        expect(parseProject(project).ok).toBe(true);
        expect(report.planner).toBe('heuristic');
        expect(Math.abs(totalDuration(project.scenes) - target)).toBeLessThan(0.3);
      }
    }
  });

  it('creates a blank project for the blank template', async () => {
    const { project, report } = await generateProject(request({ templateId: 'blank', name: 'Mine' }), deps([heuristicProvider]));
    expect(project.name).toBe('Mine');
    expect(project.scenes).toHaveLength(1);
    expect(report.planner).toBe('none');
  });

  it('uses valid AI output and reports the planner and unsupported items', async () => {
    const ai = fakeProvider(async () => ({ storyboard: validBoard, model: 'fake-1' }));
    const { project, report } = await generateProject(request(), deps([ai, heuristicProvider]));
    expect(report).toMatchObject({ planner: 'fake', model: 'fake-1', unsupported: ['3D camera fly-through'] });
    expect(report.fallbackReason).toBeUndefined();
    expect(project.brand.primary).toBe('#123456');
    expect(project.scenes.map((s) => s.name)).toEqual(['1. Title', '2. Feature list', '3. Logo reveal']);
    expect(project.generation?.planner).toBe('fake');
    // Durations were rescaled towards the requested 12 s.
    expect(Math.abs(totalDuration(project.scenes) - 12)).toBeLessThan(1);
  });

  it.each([
    ['malformed structure', { scenes: 'lots' }],
    ['unknown keys', { ...validBoard, script: 'alert(1)' }],
    ['unsupported scene kind', { ...validBoard, scenes: [{ ...validBoard.scenes[0], kind: 'three-d-orbit' }] }],
    ['bad color', { ...validBoard, palette: { primary: 'javascript:alert(1)' } }],
    ['out-of-range duration', { ...validBoard, scenes: [{ ...validBoard.scenes[0], duration: 9999 }] }],
    ['oversized text', { ...validBoard, scenes: [{ ...validBoard.scenes[0], headline: 'x'.repeat(5000) }] }],
    ['too many scenes', { ...validBoard, scenes: Array(40).fill(validBoard.scenes[0]) }],
  ])('rejects AI output with %s and falls back to the built-in planner', async (_name, storyboard) => {
    const ai = fakeProvider(async () => ({ storyboard }));
    const { project, report } = await generateProject(request(), deps([ai, heuristicProvider]));
    expect(report.planner).toBe('heuristic');
    expect(report.fallbackReason).toMatch(/Fake AI failed: output failed validation/);
    expect(parseProject(project).ok).toBe(true);
    expect(project.generation?.warnings[0]).toContain('Fake AI failed');
  });

  it('falls back when the provider throws or times out', async () => {
    const failing = fakeProvider(async () => {
      throw new Error('boom');
    });
    expect((await generateProject(request(), deps([failing]))).report.fallbackReason).toMatch(/boom/);
    const slow = fakeProvider(
      (_r, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('timed out')));
        }),
    );
    const r = await generateProject(request(), { ...deps([slow]), timeoutMs: 50 });
    expect(r.report.planner).toBe('heuristic');
    expect(r.report.fallbackReason).toMatch(/timed out/);
  });

  it('auto-selects the first configured AI provider, else the heuristic planner', () => {
    const off = fakeProvider(async () => ({ storyboard: null }), false);
    expect(selectProvider([off, heuristicProvider]).id).toBe('heuristic');
    const on = fakeProvider(async () => ({ storyboard: null }), true);
    expect(selectProvider([on, heuristicProvider]).id).toBe('fake');
    expect(() => selectProvider([heuristicProvider], 'nope')).toThrow(/unknown planner/);
  });

  it('fitDurations leaves close-enough plans alone and scales others', () => {
    expect(fitDurations(validBoard, 12)).toBe(validBoard);
    const scaled = fitDurations(validBoard, 26);
    expect(scaled.scenes.reduce((a, s) => a + s.duration, 0)).toBeCloseTo(27, 0);
  });
});

describe('provider adapters (against local fake endpoints)', () => {
  let server: http.Server;
  let base = '';
  const seen: Array<{ url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }> = [];
  let anthropicReply: Record<string, unknown> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        seen.push({ url: req.url!, headers: req.headers, body: JSON.parse(raw || '{}') });
        res.setHeader('content-type', 'application/json');
        if (req.url!.startsWith('/v1/messages')) res.end(JSON.stringify(anthropicReply));
        else if (req.url === '/oai/v1/chat/completions')
          res.end(JSON.stringify({ model: 'local-llm', choices: [{ message: { content: '```json\n' + JSON.stringify(validBoard) + '\n```' } }] }));
        else {
          res.statusCode = 500;
          res.end('{"error":"nope"}');
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const message = (stop_reason: string, text: string) => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    stop_reason,
    stop_sequence: null,
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const planRequest = { brief: NOVA, template: getTemplate('product-launch'), targetDuration: 12, settings };

  it('anthropic: sends structured-output request with fallbacks and parses the reply', async () => {
    anthropicReply = message('end_turn', JSON.stringify(validBoard));
    const p = createAnthropicProvider({ apiKey: 'test-key', model: 'claude-opus-5-5', effort: 'medium', baseURL: base });
    const r = await p.plan(planRequest, AbortSignal.timeout(5000));
    expect(StoryboardSchema.parse(r.storyboard)).toEqual(validBoard);
    const req = seen.at(-1)!;
    // SDK 1.x sends the key as a bearer token.
    expect(req.headers.authorization ?? req.headers['x-api-key']).toMatch(/test-key/);
    expect(String(req.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(req.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
  });

  it('anthropic: refusals and truncation become provider errors', async () => {
    const p = createAnthropicProvider({ apiKey: 'k', model: 'claude-opus-5-5', effort: 'low', baseURL: base });
    anthropicReply = message('refusal', '');
    await expect(p.plan(planRequest, AbortSignal.timeout(5000))).rejects.toThrow(/declined/);
    anthropicReply = message('max_tokens', '{"title":');
    await expect(p.plan(planRequest, AbortSignal.timeout(5000))).rejects.toThrow(/cut off/);
    anthropicReply = message('end_turn', 'not json');
    await expect(p.plan(planRequest, AbortSignal.timeout(5000))).rejects.toThrow(/could not parse/);
  });

  it('anthropic: is not configured without an API key', async () => {
    const p = createAnthropicProvider({ model: 'claude-opus-5-5', effort: 'medium' });
    expect(p.isConfigured()).toBe(false);
    const { report } = await generateProject(request({ provider: 'anthropic' }), deps([p, heuristicProvider]));
    expect(report.planner).toBe('heuristic');
    expect(report.fallbackReason).toMatch(/not configured/);
  });

  it('openai-compatible: posts JSON-mode chat completion and tolerates code fences', async () => {
    const p = createOpenAICompatibleProvider({ baseURL: `${base}/oai/v1`, model: 'llama', apiKey: 'sk-local' });
    const r = await p.plan(planRequest, AbortSignal.timeout(5000));
    expect(r.model).toBe('local-llm');
    expect(StoryboardSchema.parse(r.storyboard)).toEqual(validBoard);
    const req = seen.at(-1)!;
    expect(req.headers.authorization).toBe('Bearer sk-local');
    expect(req.body).toMatchObject({ model: 'llama', response_format: { type: 'json_object' } });
  });

  it('openai-compatible: HTTP errors become provider errors', async () => {
    const p = createOpenAICompatibleProvider({ baseURL: `${base}/broken`, model: 'x' });
    await expect(p.plan(planRequest, AbortSignal.timeout(5000))).rejects.toThrow(/HTTP 500/);
  });

  it('parseJsonObject extracts the object and rejects non-JSON', () => {
    expect(parseJsonObject('Here: {"a":1} thanks')).toEqual({ a: 1 });
    expect(() => parseJsonObject('nothing here')).toThrow();
  });
});
