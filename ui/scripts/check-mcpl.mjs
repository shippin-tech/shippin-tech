// MCPL v0 conformance for this app. Fails the build when the UI and its MCPL
// description disagree, and keeps mcpl/variant.json current.
//
//   node scripts/check-mcpl.mjs           # check (CI)
//   node scripts/check-mcpl.mjs --write   # also rewrite mcpl/variant.json
import Ajv2020 from 'ajv/dist/2020.js';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ui = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(ui, '..');
const write = process.argv.includes('--write');
const problems = [];
const fail = (message) => problems.push(message);
const rel = (path) => relative(root, path).replaceAll('\\', '/');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

function walk(dir, test, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, test, out);
    else if (test(path)) out.push(path);
  }
  return out;
}

// Schemas
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const schemaDir = join(root, 'mcpl/schema');
for (const name of readdirSync(schemaDir)) ajv.addSchema(json(join(schemaDir, name)), name);
const validator = (name) => ajv.getSchema(name);
const validate = (name, value, where) => {
  const check = validator(name);
  if (!check(value)) for (const e of check.errors) fail(`${where}: ${e.instancePath || '/'} ${e.message}`);
};

// Layer: components
const folders = ['src/lib/catalog', 'src/lib/shippin'].map((folder) => join(ui, folder));
const components = [];
const areas = folders.flatMap((folder) => readdirSync(folder).map((id) => ({ id, dir: join(folder, id) })));
areas.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
for (const { id, dir } of areas) {
  if (!statSync(dir).isDirectory()) continue;
  const manifestPath = join(dir, 'component.json');
  if (!existsSync(manifestPath)) {
    fail(`${rel(dir)}: component folder without component.json`);
    continue;
  }
  const manifest = json(manifestPath);
  validate('component.schema.json', manifest, rel(manifestPath));
  if (manifest.id !== id) fail(`${rel(manifestPath)}: id "${manifest.id}" is not the folder name "${id}"`);
  if (!existsSync(join(dir, 'instruction.md'))) fail(`${rel(dir)}: missing instruction.md`);
  const variantsPath = join(dir, 'variants.ts');
  if (existsSync(variantsPath)) {
    const listed = [...readFileSync(variantsPath, 'utf8').matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    if (JSON.stringify(listed) !== JSON.stringify(manifest.variants ?? [])) {
      fail(`${rel(variantsPath)}: variants ${JSON.stringify(listed)} differ from component.json ${JSON.stringify(manifest.variants)}`);
    }
  }
  for (const key of ['engine', 'kernel', 'html']) {
    const path = manifest[key];
    if (typeof path === 'string' && /^(crates|ui|resources)\//.test(path) && !existsSync(join(root, path))) {
      fail(`${rel(manifestPath)}: ${key} path ${path} does not exist`);
    }
  }
  components.push(manifest);
}
const declared = new Map();
for (const c of components) for (const type of c.emits ?? []) {
  if (declared.has(type)) fail(`event ${type} is declared by both ${declared.get(type)} and ${c.id}`);
  declared.set(type, c.id);
}

// Layer: events (every emitted type declared, every declared type emitted)
const sources = walk(join(ui, 'src'), (p) => /\.(ts|svelte)$/.test(p));
const emitted = new Map();
for (const path of sources) {
  for (const m of readFileSync(path, 'utf8').matchAll(/mcplEmit\(\s*'([^']+)'/g)) {
    if (!emitted.has(m[1])) emitted.set(m[1], rel(path));
  }
}
for (const [type, where] of emitted) {
  if (!declared.has(type)) fail(`${where}: emits ${type}, which no component.json declares`);
  if (!ajv.validate({ $ref: 'event.schema.json#/$defs/eventType' }, type)) fail(`${where}: ${type} is not a valid event type`);
}
for (const [type, owner] of declared) if (!emitted.has(type)) fail(`catalog/${owner}: declares ${type}, but nothing emits it`);

// Layer: lessons
const lessonDir = join(ui, 'src/lib/mcpl/lessons');
const lessons = [];
for (const name of readdirSync(lessonDir).filter((n) => n.endsWith('.json')).sort()) {
  const lesson = json(join(lessonDir, name));
  validate('lesson.schema.json', lesson, rel(join(lessonDir, name)));
  for (const step of lesson.steps ?? []) {
    if (!declared.has(step.doneWhen)) fail(`lesson ${lesson.id}: step ${step.id} waits for ${step.doneWhen}, which no component emits`);
  }
  lessons.push(lesson);
}

// The assistant's guide: what the lessons teach, generated so the server can read it.
const guidePath = join(root, 'resources/product/lessons.json');
const guide = JSON.stringify(
  lessons.map((l) => ({ id: l.id, title: l.title, audience: l.audience, steps: l.steps.map((s) => ({ say: s.say, where: s.where })) })),
  null,
  2
) + '\n';
if (write) writeFileSync(guidePath, guide);
else if (!existsSync(guidePath) || readFileSync(guidePath, 'utf8').replaceAll('\r\n', '\n') !== guide) {
  fail('resources/product/lessons.json is out of date; run: node scripts/check-mcpl.mjs --write');
}

// Layer: actions (proposed extension "drive"). An agent's MCP tool is an action a screen
// declares and carries out itself, on the operator's screen, with the code its own
// controls use. Declared means real here too: every action is bound with a literal
// onAction('<name>', ...) in the UI, and nothing undeclared is bound.
const actions = [];
for (const c of components) {
  for (const action of c.actions ?? []) {
    const where = `${c.id}/component.json: action ${action.name}`;
    if (actions.some((a) => a.name === action.name)) fail(`${where} is declared twice`);
    if (!(c.routes ?? []).includes(action.route)) fail(`${where}: route ${action.route} is not one of the component's routes`);
    if (action.emits && !(c.emits ?? []).includes(action.emits)) fail(`${where}: emits ${action.emits}, which the component does not declare`);
    for (const name of action.secret ?? []) {
      if (!action.input?.properties?.[name]) fail(`${where}: secret argument ${name} is not in its input`);
    }
    if (!action.writes && action.destructive) fail(`${where}: a destructive action must write`);
    actions.push({ ...action, component: c.id });
  }
}
const bound = new Map();
for (const path of sources) {
  for (const m of readFileSync(path, 'utf8').matchAll(/onAction\(\s*'([^']+)'/g)) {
    if (bound.has(m[1])) fail(`${rel(path)}: action ${m[1]} is bound twice (also in ${bound.get(m[1])})`);
    else bound.set(m[1], rel(path));
  }
}
for (const [name, where] of bound) if (!actions.some((a) => a.name === name)) fail(`${where}: binds ${name}, which no component.json declares`);
for (const a of actions) if (!bound.has(a.name)) fail(`${a.component}/component.json: declares action ${a.name}, but nothing binds it`);
actions.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

// What the server serves as MCP tools (crates/http/src/shippin/mcp.rs), generated here.
const toolsPath = join(root, 'resources/product/actions.json');
const tools = JSON.stringify(
  {
    tools: actions.map((a) => ({
      name: a.name,
      title: a.title,
      description: a.description,
      inputSchema: a.input,
      annotations: { title: a.title, readOnlyHint: !a.writes, destructiveHint: Boolean(a.destructive), idempotentHint: !a.writes, openWorldHint: false },
      route: a.route,
      writes: a.writes,
      secret: a.secret ?? [],
      component: a.component,
      ...(a.emits ? { emits: a.emits } : {})
    }))
  },
  null,
  2
) + '\n';
if (write) writeFileSync(toolsPath, tools);
else if (!existsSync(toolsPath) || readFileSync(toolsPath, 'utf8').replaceAll('\r\n', '\n') !== tools) {
  fail('resources/product/actions.json is out of date; run: node scripts/check-mcpl.mjs --write');
}

// Layer: map (AI kernels and every instruction link)
const runtime = join(ui, 'src/lib/ai-runtime');
const kernels = readdirSync(runtime).filter((area) => existsSync(join(runtime, area, 'kernel/instruction.md'))).sort();
for (const path of walk(join(ui, 'src/lib'), (p) => p.endsWith('instruction.md'))) {
  const text = readFileSync(path, 'utf8');
  const targets = [
    ...[...text.matchAll(/Kernel: `([^`]+)`/g)].map((m) => m[1]),
    ...[...text.matchAll(/^\|[^|]+\|\s*([^|\s]+instruction\.md)\s*\|/gm)].map((m) => m[1])
  ];
  for (const target of targets) {
    const absolute = target.startsWith('ui/') ? join(root, target) : resolve(dirname(path), target);
    if (!existsSync(absolute)) fail(`${rel(path)}: link ${target} does not resolve`);
  }
}

// Variant manifest
const variant = {
  mcpl: '0',
  variant: 'shippin-tech-mail',
  stack: { ui: 'SvelteKit 5', engine: 'Rust' },
  layers: { map: 'implemented', components: 'implemented', events: 'implemented', lessons: 'implemented', conformance: 'implemented', actions: 'implemented' },
  map: { kernels },
  components: components.map((c) => ({ id: c.id, a2ui: c.a2ui, routes: c.routes, emits: c.emits })),
  events: [...declared.keys()].sort(),
  lessons: lessons.map((l) => ({ id: l.id, audience: l.audience, steps: l.steps.map((s) => `${s.id} <- ${s.doneWhen}`) })),
  actions: actions.map((a) => ({ name: a.name, component: a.component, writes: a.writes, ...(a.emits ? { emits: a.emits } : {}) }))
};
validate('variant.schema.json', variant, 'mcpl/variant.json');
const variantPath = join(root, 'mcpl/variant.json');
const text = JSON.stringify(variant, null, 2) + '\n';
if (write) writeFileSync(variantPath, text);
else if (!existsSync(variantPath) || readFileSync(variantPath, 'utf8').replaceAll('\r\n', '\n') !== text) {
  fail('mcpl/variant.json is out of date; run: node scripts/check-mcpl.mjs --write');
}

if (problems.length) {
  console.error(`MCPL conformance failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`MCPL v0 conformance passed: ${components.length} components, ${declared.size} events, ${lessons.length} lesson(s), ${kernels.length} kernels.`);
