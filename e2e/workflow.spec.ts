/**
 * The v0.1 definition of success, end to end in a real browser with no AI credentials:
 * create a launch project from a brief → editable multi-scene animation → change the headline
 * and brand color → preview → export a playable MP4 → reopen → re-render.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const NEW_HEADLINE = 'Nova is here';
const NEW_PRIMARY = '#ff3d81';

function probe(file: string) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', file]);
  const data = JSON.parse(out.toString());
  return { ...data.streams[0], duration: Number(data.format.duration) };
}

/** Fraction of pixels in a decoded frame that are close to the given color. */
function colorShare(file: string, at: number, hex: string): number {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=320:180', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let hits = 0;
  for (let i = 0; i < raw.length; i += 3) {
    if (Math.abs(raw[i]! - r!) + Math.abs(raw[i + 1]! - g!) + Math.abs(raw[i + 2]! - b!) < 60) hits++;
  }
  return hits / (raw.length / 3);
}

async function renderAndDownload(page: Page, request: Page['request']): Promise<string> {
  await page.getByRole('button', { name: 'Render MP4' }).first().click();
  const result = page.getByTestId('render-result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(result).toContainText('Verified');
  const src = await result.locator('video').getAttribute('src');
  expect(src).toMatch(/^\/media\/renders\/.+\.mp4$/);
  const res = await request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('video/mp4');
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'sw-e2e-')), 'out.mp4');
  writeFileSync(file, await res.body());
  return file;
}

test('brief → edit headline & brand color → preview → export → reopen → re-render', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  // 1–3. Open the app and create a project from the launch brief (offline planner).
  await page.goto('/');
  await expect(page.getByText('Renderer ready')).toBeVisible();
  await page.getByLabel('New project name').fill('Nova launch');
  await expect(page.getByLabel('Brief')).toHaveValue(/called Nova/);
  await page.getByLabel('Format').selectOption('720p');
  await page.getByLabel('Frame rate').selectOption('24');
  await page.getByRole('button', { name: 'Generate editable animation' }).click();

  // 4. An editable multi-scene structure.
  const scenes = page.getByRole('complementary', { name: 'Scenes' }).getByRole('listitem');
  await expect(scenes).toHaveCount(3);
  await expect(scenes.nth(0)).toContainText('Title');
  await expect(scenes.nth(1)).toContainText('Product reveal');
  await expect(scenes.nth(2)).toContainText('Logo reveal');
  await expect(page.getByTestId('timecode')).toContainText('0:12.00');

  // 5a. Change the headline of the first scene.
  await scenes.nth(0).getByRole('button', { name: /Select scene/ }).click();
  await page.getByRole('button', { name: 'Select layer Headline' }).click();
  const text = page.getByLabel('Text', { exact: true });
  await expect(text).toHaveValue('Meet Nova');
  await text.fill(NEW_HEADLINE);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  // 5b. Change the brand primary color.
  await page.getByRole('tab', { name: 'Brand' }).click();
  await page.getByLabel('Brand primary hex').fill(NEW_PRIMARY);
  await expect(page.getByTestId('save-status')).toHaveText('Saved', { timeout: 10_000 });

  // 6. Preview: playback advances the timecode and the canvas shows content.
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Pause' }).click();
  const tc = await page.getByTestId('timecode').innerText();
  expect(tc.startsWith('0:00.00')).toBe(false);
  const litPixels = await page.getByTestId('preview-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! > 200) n++;
    return n;
  });
  expect(litPixels).toBeGreaterThan(100);

  // 7. Export a playable video file.
  const first = await renderAndDownload(page, page.request);
  const p1 = probe(first);
  expect(p1.codec_name).toBe('h264');
  expect([p1.width, p1.height]).toEqual([1280, 720]);
  expect(Number(p1.nb_read_frames)).toBe(288);
  expect(p1.duration).toBeCloseTo(12, 1);
  // The new brand color fills the generated logo mark in the final scene; the old purple is gone.
  expect(colorShare(first, 10.5, NEW_PRIMARY)).toBeGreaterThan(0.002);
  expect(colorShare(first, 10.5, '#7c5cff')).toBeLessThan(0.0005);

  // 8. Reopen the saved project from the project list.
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: 'Open project Nova launch' }).click();
  await scenes.nth(0).getByRole('button', { name: /Select scene/ }).click();
  await page.getByRole('button', { name: 'Select layer Headline' }).click();
  await expect(page.getByLabel('Text', { exact: true })).toHaveValue(NEW_HEADLINE);
  await page.getByRole('tab', { name: 'Brand' }).click();
  await expect(page.getByLabel('Brand primary hex')).toHaveValue(NEW_PRIMARY);

  // 9. Re-render the reopened project.
  await page.getByRole('tab', { name: 'Render' }).click();
  const second = await renderAndDownload(page, page.request);
  expect(Number(probe(second).nb_read_frames)).toBe(288);

  expect(consoleErrors).toEqual([]);
});
