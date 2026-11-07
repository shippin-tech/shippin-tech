import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const inventory = JSON.parse(await readFile(resolve(root, 'ui/porting/webui-files.json'), 'utf8'));
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? files(path) : relative(root, path).replaceAll('\\', '/');
  }))).flat();
}
const actual = new Set(await files(resolve(root, 'assets/webui')));
const seen = new Set();
for (const entry of inventory.files) {
  if (seen.has(entry.source) || !actual.has(entry.source)) throw new Error(`Duplicate or missing source: ${entry.source}`);
  seen.add(entry.source);
  const hash = createHash('sha256').update(await readFile(resolve(root, entry.source))).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Source changed; review port disposition: ${entry.source}`);
  if (!entry.owners.length || !entry.status || !entry.remaining) throw new Error(`Missing disposition: ${entry.source}`);
  for (const owner of entry.owners) await stat(resolve(root, owner));
}
const missing = [...actual].filter((source) => !seen.has(source));
if (missing.length) throw new Error(`Uninventoried webui files: ${missing.join(', ')}`);
console.log(`${seen.size} original files accounted for. This checks inventory coverage, not functional parity.`);
