// Renders frames of a project with the Node (Skia) engine, as base64 PNGs on stdout.
//   node --import tsx e2e/parity-frames.ts <project.json> <t> [<t> ...]
import { readFileSync } from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';
import { renderFrame } from '../src/engine/render';
import type { Ctx2D } from '../src/engine/types';
import { loadProject } from '../src/project/migrate';
import { createNodeEnv, mapAssetResolver, registerFonts } from '../src/render/node-env';

const [file, ...times] = process.argv.slice(2);
const parsed = loadProject(JSON.parse(readFileSync(file!, 'utf8')));
if (!parsed.ok) throw new Error(`invalid project: ${JSON.stringify(parsed.issues)}`);
const project = parsed.value;
registerFonts();
const canvas = createCanvas(project.settings.width, project.settings.height);
const env = createNodeEnv(mapAssetResolver(new Map()));
const frames = times.map((t) => {
  renderFrame(canvas.getContext('2d') as unknown as Ctx2D, project, Number(t), env);
  return canvas.toBuffer('image/png').toString('base64');
});
process.stdout.write(JSON.stringify(frames));
