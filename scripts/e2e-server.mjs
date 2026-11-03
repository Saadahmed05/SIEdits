// Playwright's web server: a fresh data directory, a fresh build, then the production server.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const dataDir = '.tmp/e2e-data';
rmSync(dataDir, { recursive: true, force: true });
const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
process.env.DATA_DIR = dataDir;
await import('./start.mjs');
