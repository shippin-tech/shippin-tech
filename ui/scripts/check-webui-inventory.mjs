import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const inventory = JSON.parse(await readFile(resolve(root, 'ui/porting/webui-files.json'), 'utf8'));
const queue = JSON.parse(await readFile(resolve(root, 'ui/porting/work-packages.json'), 'utf8'));
const packages = new Map();
for (const packet of queue.packages) {
  if (packages.has(packet.id)) throw new Error(`Duplicate work package: ${packet.id}`);
  if (!packet.track || !packet.title || !packet.code_owners?.length || !packet.batches?.length || !packet.acceptance?.length) {
    throw new Error(`Incomplete work package: ${packet.id}`);
  }
  if (!['queued', 'in-progress', 'done'].includes(packet.status)) throw new Error(`Invalid package status: ${packet.id}`);
  for (const owner of packet.code_owners) await stat(resolve(root, owner));
  packages.set(packet.id, packet);
}
const visited = new Set();
const visiting = new Set();
function visit(id) {
  const packet = packages.get(id);
  if (!packet) throw new Error(`Unknown work package: ${id}`);
  if (visiting.has(id)) throw new Error(`Cyclic work-package dependency: ${id}`);
  if (visited.has(id)) return;
  visiting.add(id);
  for (const dependency of packet.depends_on) visit(dependency);
  visiting.delete(id);
  visited.add(id);
  if (packet.status === 'done' && (!packet.evidence?.length || packet.depends_on.some((dependency) => packages.get(dependency).status !== 'done'))) {
    throw new Error(`Completed package lacks evidence or completed dependencies: ${id}`);
  }
}
for (const id of packages.keys()) visit(id);
for (const [track, id] of Object.entries(queue.next_by_track)) {
  const packet = packages.get(id);
  if (!packet || packet.track !== track || packet.status === 'done' || packet.depends_on.some((dependency) => packages.get(dependency).status !== 'done')) {
    throw new Error(`Next package is not eligible in track ${track}: ${id}`);
  }
}
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
  // Hash with line endings normalised so Windows (CRLF) and Linux (LF) checkouts agree.
  const bytes = await readFile(resolve(root, entry.source));
  const text = /\.(js|css|html|svg|json|txt)$/.test(entry.source);
  const hash = createHash('sha256').update(text ? bytes.toString('utf8').replaceAll('\r\n', '\n') : bytes).digest('hex');
  if (hash !== entry.sha256) throw new Error(`Source changed; review port disposition: ${entry.source}`);
  if (!entry.owners.length || !entry.status || !entry.remaining) throw new Error(`Missing disposition: ${entry.source}`);
  if (!entry.work_packages?.length || entry.work_packages.some((id) => !packages.has(id))) {
    throw new Error(`Missing or unknown work-package assignment: ${entry.source}`);
  }
  for (const owner of entry.owners) await stat(resolve(root, owner));
}
const missing = [...actual].filter((source) => !seen.has(source));
if (missing.length) throw new Error(`Uninventoried webui files: ${missing.join(', ')}`);
console.log(`${seen.size} original files accounted for; ${packages.size} work packages have valid owners, assignments and acyclic dependencies. This checks planning coverage, not functional parity.`);
