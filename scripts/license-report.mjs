// Lists every production dependency (transitive) with its declared license.
//   npm run licenses            # table
//   npm run licenses -- --json  # machine-readable
import { execSync } from 'node:child_process';

// Through a shell: on Windows npm is a .cmd script, which cannot be spawned directly.
// --long makes npm include each package's manifest, so the license needs no file access.
const tree = JSON.parse(execSync('npm ls --omit=dev --all --json --long', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const seen = new Map();
const walk = (deps = {}) => {
  for (const [name, info] of Object.entries(deps)) {
    const key = `${name}@${info.version}`;
    if (seen.has(key) || !info.path) continue;
    const license = typeof info.license === 'string' ? info.license : info.license?.type ?? (info.licenses ? info.licenses.map((l) => l.type).join(' OR ') : 'UNKNOWN');
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
