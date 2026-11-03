// Runs the API server (with reload) and the Vite dev server together; Ctrl+C stops both.
// Both start through this Node binary rather than npx, which Windows cannot spawn directly.
// Vite waits for the API, so the editor can never load before there is a server behind it.
import { spawn, spawnSync } from 'node:child_process';

const API_WAIT_MS = 60_000;
const node = process.execPath;
const health = `http://127.0.0.1:${process.env.PORT ?? 8787}/api/health`;
const procs = [];
let stopping = false;

// tsx watch runs the server in a child, which SIGTERM would orphan on Windows.
const kill = (p) => {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/t', '/f'], { stdio: 'ignore' });
  else p.kill('SIGTERM');
};
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) kill(p);
  process.exit(code);
};
const run = (args) => {
  const p = spawn(node, args, { stdio: 'inherit' });
  procs.push(p);
  p.on('exit', (code) => stop(code ?? 1));
};

async function apiReady() {
  const deadline = Date.now() + API_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(health)).ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run(['node_modules/tsx/dist/cli.mjs', 'watch', 'src/server/index.ts']);
if (!(await apiReady())) console.warn(`API did not answer at ${health} within ${API_WAIT_MS / 1000} s; starting the editor anyway.`);
run(['node_modules/vite/bin/vite.js']);
