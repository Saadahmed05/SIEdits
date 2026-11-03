/**
 * Preview must match export. Renders the same frames with the engine in a real browser and in
 * Node, then compares pixels. The two rasterisers differ slightly at glyph and curve edges, so
 * this is a budget rather than equality: enough to catch drift in the shared drawing code.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const PROJECT = 'examples/siedits-launch.project.json';
const TIMES = [0.5, 1.5, 3.5, 6, 8.5, 10.5];
const WEB_PORT = 5199;
/** Worst values on the reference run were 1.55 and 0.14%; the budget leaves room for platforms. */
const MAX_MEAN_DIFF = 3;
const MAX_PCT_OVER_32 = 0.5;

let vite: ViteDevServer;

test.beforeAll(async () => {
  process.env.PORT = String(new URL(test.info().project.use.baseURL!).port);
  vite = await createServer({ server: { host: '127.0.0.1', port: WEB_PORT, strictPort: true }, logLevel: 'error' });
  await vite.listen();
});

test.afterAll(async () => {
  await vite?.close();
});

test('preview frames match export frames within budget', async ({ page }) => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'e2e/parity-frames.ts', PROJECT, ...TIMES.map(String)], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const nodeFrames: string[] = JSON.parse(output);

  await page.goto(`http://127.0.0.1:${WEB_PORT}/`);
  const raw = JSON.parse(readFileSync(PROJECT, 'utf8'));
  const results = await page.evaluate(
    async ({ raw, times, nodeFrames }) => {
      const load = (path: string) => import(/* @vite-ignore */ path);
      const { renderFrame } = await load('/src/engine/render.ts');
      const { createBrowserEnv, loadFonts } = await load('/src/editor/runtime.ts');
      const { loadProject } = await load('/src/project/migrate.ts');
      await loadFonts();
      const parsed = loadProject(raw);
      if (!parsed.ok) throw new Error('invalid project');
      const project = parsed.value;
      const { width: W, height: H } = project.settings;
      const env = { ...createBrowserEnv({ get: () => undefined }, 1), showMissingAssets: false };
      const surface = () => {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        return canvas.getContext('2d', { willReadFrequently: true })!;
      };
      const out = [];
      for (const [i, t] of times.entries()) {
        const browser = surface();
        renderFrame(browser, project, t, env);
        const image = new Image();
        image.src = `data:image/png;base64,${nodeFrames[i]}`;
        await image.decode();
        const node = surface();
        node.drawImage(image, 0, 0);
        const a = browser.getImageData(0, 0, W, H).data;
        const b = node.getImageData(0, 0, W, H).data;
        let sum = 0;
        let over32 = 0;
        for (let p = 0; p < a.length; p += 4) {
          const d = Math.max(Math.abs(a[p]! - b[p]!), Math.abs(a[p + 1]! - b[p + 1]!), Math.abs(a[p + 2]! - b[p + 2]!));
          sum += d;
          if (d > 32) over32++;
        }
        out.push({ t, meanDiff: sum / (W * H), pctOver32: (100 * over32) / (W * H) });
      }
      return out;
    },
    { raw, times: TIMES, nodeFrames },
  );

  console.log(results.map((r) => `t=${r.t}: mean ${r.meanDiff.toFixed(3)}, >32 ${r.pctOver32.toFixed(3)}%`).join('\n'));
  for (const r of results) {
    expect(r.meanDiff, `mean difference at t=${r.t}`).toBeLessThan(MAX_MEAN_DIFF);
    expect(r.pctOver32, `pixels far off at t=${r.t}`).toBeLessThan(MAX_PCT_OVER_32);
  }
});
