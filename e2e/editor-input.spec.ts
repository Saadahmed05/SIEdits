/** Canvas selection of rotated elements, and the Windows redo shortcut. */
import { expect, test } from '@playwright/test';

test('selects a rotated element where it is drawn, and Ctrl+Y redoes', async ({ page, request }) => {
  const res = await request.post('/api/projects', {
    data: { name: 'Rotated bar', templateId: 'blank', settings: { width: 1280, height: 720, fps: 30 } },
  });
  const { project } = await res.json();
  const scene = project.scenes[0];
  scene.background = { type: 'solid', color: '#000000' };
  scene.elements = [{ id: 'bar', name: 'Bar', type: 'shape', shape: 'rect', x: 0.5, y: 0.5, width: 0.6, height: 0.05, fill: '#ffffff', rotation: 90 }];
  expect((await request.put(`/api/projects/${project.id}`, { data: project })).status()).toBe(200);

  await page.goto(`/#/p/${project.id}`);
  const canvas = page.getByTestId('preview-canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.width * fx, y: box.height * fy });
  const layerName = page.getByLabel('Layer name');

  // Rotated 90°, the bar's unrotated box runs left to right, but the bar is drawn top to bottom.
  await canvas.click({ position: at(0.75, 0.5) });
  await expect(layerName).toHaveCount(0);
  await canvas.click({ position: at(0.5, 0.2) });
  await expect(layerName).toHaveValue('Bar');

  // Move it, undo, then redo with Ctrl+Y.
  const undo = page.getByRole('button', { name: 'Undo' });
  const redo = page.getByRole('button', { name: 'Redo' });
  await page.mouse.move(box.x + at(0.5, 0.2).x, box.y + at(0.5, 0.2).y);
  await page.mouse.down();
  await page.mouse.move(box.x + at(0.6, 0.2).x, box.y + at(0.6, 0.2).y, { steps: 4 });
  await page.mouse.up();
  await expect(undo).toBeEnabled();
  await page.keyboard.press('Control+z');
  await expect(redo).toBeEnabled();
  await page.keyboard.press('Control+y');
  await expect(redo).toBeDisabled();
  await expect(undo).toBeEnabled();
});
