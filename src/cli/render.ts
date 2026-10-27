/**
 * Render a project file to MP4 from the command line.
 *
 *   npm run render -- <project.json | bundle.scenewright.json> <out.mp4> [--assets <dir>]
 *
 * Bundles (exported with embedded assets) are unpacked to a temporary directory first.
 * Plain project files read assets from --assets, defaulting to an "assets" directory next
 * to the project file.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isBundle, unpackBundle } from '../project/bundle';
import { RenderError } from '../render/errors';
import { renderVideo } from '../render/render-video';
import { writeBundleAssets } from '../server/storage';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const assetsFlag = args.indexOf('--assets');
  const assetsArg = assetsFlag >= 0 ? args.splice(assetsFlag, 2)[1] : undefined;
  const [input, output] = args;
  if (!input || !output) {
    console.error('usage: npm run render -- <project.json> <out.mp4> [--assets <dir>]');
    return 2;
  }
  const json = JSON.parse(await readFile(input, 'utf8')) as unknown;
  let project: unknown = json;
  let assetsDir = assetsArg ?? path.join(path.dirname(path.resolve(input)), 'assets');
  let tempDir: string | null = null;

  if (isBundle(json)) {
    const unpacked = unpackBundle(json);
    if (!unpacked.ok) {
      console.error('Invalid bundle:');
      for (const i of unpacked.issues) console.error(`  ${i.path}: ${i.message}`);
      return 1;
    }
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'scenewright-'));
    await writeBundleAssets(tempDir, unpacked.files);
    project = unpacked.project;
    assetsDir = tempDir;
  }

  const started = Date.now();
  try {
    const result = await renderVideo(project, {
      assetsDir,
      output: path.resolve(output),
      onProgress: (p) => {
        if (process.stdout.isTTY) process.stdout.write(`\r${p.phase} ${p.frame}/${p.totalFrames}   `);
      },
    });
    if (process.stdout.isTTY) process.stdout.write('\n');
    const { probe } = result;
    console.log(
      `Rendered ${result.output}\n  ${probe.width}x${probe.height} ${probe.codec} ${probe.pixelFormat}, ${probe.frames} frames @ ${probe.fps} fps, ${probe.duration.toFixed(3)} s, in ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    return 0;
  } catch (err) {
    if (err instanceof RenderError) {
      console.error(`Render failed [${err.code}]: ${err.message}`);
      for (const i of err.issues) console.error(`  ${i.path}: ${i.message}`);
      return 1;
    }
    throw err;
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

main().then((code) => process.exit(code));
