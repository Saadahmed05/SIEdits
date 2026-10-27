/**
 * Validate project or bundle files without rendering.
 *   npm run validate -- <file.json> [more.json…]
 * Exit code 0 when all files are valid, 1 otherwise.
 */
import { readFile } from 'node:fs/promises';
import { isBundle, unpackBundle } from '../project/bundle';
import { loadProject } from '../project/migrate';
import { totalDuration } from '../engine/timeline';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: npm run validate -- <project.json> [...]');
  process.exit(2);
}
let failed = 0;
for (const file of files) {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    console.error(`✗ ${file}: ${(err as Error).message}`);
    failed++;
    continue;
  }
  const result = isBundle(json) ? unpackBundle(json) : loadProject(json);
  if (result.ok) {
    const project = 'project' in result ? result.project : result.value;
    console.log(`✓ ${file}: "${project.name}", ${project.scenes.length} scenes, ${totalDuration(project.scenes).toFixed(2)} s, ${project.settings.width}x${project.settings.height}@${project.settings.fps}`);
  } else {
    failed++;
    console.error(`✗ ${file}:`);
    for (const i of result.issues) console.error(`    ${i.path}: ${i.message}`);
  }
}
process.exit(failed ? 1 : 0);
