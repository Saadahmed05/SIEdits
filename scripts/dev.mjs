// Runs the API server (with reload) and the Vite dev server together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', 'src/server/index.ts'], { stdio: 'inherit' }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
];
const stop = (code = 0) => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit(code);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const p of procs) p.on('exit', (code) => stop(code ?? 1));
