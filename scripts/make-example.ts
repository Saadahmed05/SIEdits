/**
 * Regenerates examples/nova-launch.project.json with the deterministic planner.
 *   npx tsx scripts/make-example.ts
 */
import { writeFile } from 'node:fs/promises';
import { generateProject } from '../src/ai/generate';
import { heuristicProvider } from '../src/ai/heuristic';
import { getTemplate } from '../src/storyboard/templates';

const { project, report } = await generateProject(
  {
    brief: getTemplate('product-launch').defaultBrief,
    templateId: 'product-launch',
    settings: { width: 1920, height: 1080, fps: 30 },
    targetDuration: 12,
    name: 'Nova launch',
  },
  { providers: [heuristicProvider], newId: () => 'nova-launch', now: () => '2026-10-22T00:00:00.000Z' },
);
await writeFile('examples/nova-launch.project.json', `${JSON.stringify(project, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
