// Lists every production dependency (transitive) with its declared license.
//   npm run licenses            # table
//   npm run licenses -- --json  # machine-readable
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const tree = JSON.parse(execFileSync('npm', ['ls', '--omit=dev', '--all', '--json', '--long'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const seen = new Map();
const walk = (deps = {}) => {
  for (const [name, info] of Object.entries(deps)) {
    const key = `${name}@${info.version}`;
    if (seen.has(key) || !info.path) continue;
    let license = 'UNKNOWN';
    try {
      const pkg = JSON.parse(readFileSync(path.join(info.path, 'package.json'), 'utf8'));
      license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? (pkg.licenses ? pkg.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN');
    } catch {}
    seen.set(key, { name, version: info.version, license });
    walk(info.dependencies);
  }
};
walk(tree.dependencies);
const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 2));
else {
  const counts = {};
  for (const r of rows) counts[r.license] = (counts[r.license] ?? 0) + 1;
  for (const r of rows) console.log(`${r.license.padEnd(14)} ${r.name}@${r.version}`);
  console.log(`\n${rows.length} production packages:`, counts);
}
