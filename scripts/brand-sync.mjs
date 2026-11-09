import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const HEX = /^#[0-9a-fA-F]{6}$/;

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
	const out = { ...base };
	for (const [k, v] of Object.entries(over ?? {})) out[k] = isObject(v) && isObject(base[k]) ? merge(base[k], v) : v;
	return out;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

// brand/custom wins over brand/ for the manifest and for each asset by file name.
export function loadBrand(base = root) {
	const defaults = readJson(join(base, 'brand/brand.json'));
	const customPath = join(base, 'brand/custom/brand.json');
	const brand = merge(defaults, existsSync(customPath) ? readJson(customPath) : {});
	const asset = (name, optional = false) => {
		for (const dir of ['brand/custom/assets', 'brand/assets']) {
			const p = join(base, dir, name);
			if (existsSync(p)) return readFileSync(p);
		}
		if (optional) return null;
		throw new Error(`brand asset missing: ${name}`);
	};
	const mark = asset('mark.svg').toString('utf8').trim();
	const favicon = (asset('favicon.svg', true) ?? Buffer.from(mark)).toString('utf8').trim();
	return { brand, mark, favicon, ico: asset('favicon.ico', true), font: loadPixelFont(base) };
}

// The wordmark is drawn from a pixel font so it needs no webfont download and renders the same
// everywhere (UI header, landing page, standalone logo.svg). Forks override single glyphs or the
// cell size in brand/custom/pixel-font.json.
export function loadPixelFont(base = root) {
	const defaults = readJson(join(base, 'brand/pixel-font.json'));
	const customPath = join(base, 'brand/custom/pixel-font.json');
	const font = merge(defaults, existsSync(customPath) ? readJson(customPath) : {});
	delete font.$comment;
	return font;
}

export function validatePixelFont(font, text) {
	const errors = [];
	const [, rows] = Array.isArray(font.cell) ? font.cell : [];
	if (!Number.isInteger(rows) || rows < 1) errors.push('pixel-font cell must be [columns, rows]');
	if (!Number.isInteger(font.baseline) || font.baseline < 1 || font.baseline > rows) errors.push('pixel-font baseline must sit inside the cell');
	const glyphs = font.glyphs ?? {};
	for (const [ch, lines] of Object.entries(glyphs)) {
		if (!Array.isArray(lines) || lines.length === 0 || lines.length > rows) { errors.push(`glyph ${JSON.stringify(ch)} must have 1..${rows} rows`); continue; }
		const width = lines[0].length;
		for (const line of lines) {
			if (typeof line !== 'string' || line.length !== width || !/^[#.]*$/.test(line)) { errors.push(`glyph ${JSON.stringify(ch)} rows must be equal-length strings of # and .`); break; }
		}
	}
	for (const ch of new Set(text)) if (!glyphs[ch]) errors.push(`pixel-font has no glyph for ${JSON.stringify(ch)}`);
	return errors;
}

// Lays out text as unit squares. Returns the rects and the advance width in cells.
function layoutPixels(font, text) {
	const rects = [];
	let x = 0;
	for (const ch of text) {
		const lines = font.glyphs[ch];
		const width = lines[0].length;
		lines.forEach((line, y) => {
			for (let i = 0; i < line.length; i++) if (line[i] === '#') rects.push([x + i, y]);
		});
		x += width + (font.advance ?? 1);
	}
	return { rects, width: Math.max(0, x - (font.advance ?? 1)) };
}

// Compact path (one M/h/v/h/z subpath per pixel) so the SVG stays small and inlines cleanly.
function pixelPath(rects, offsetX = 0) {
	return rects.map(([x, y]) => `M${x + offsetX} ${y}h1v1h-1z`).join('');
}

export function wordmarkSvg({ brand, font }, { inline = true } = {}) {
	const [a, b] = brand.nameParts;
	const rows = font.cell[1];
	const first = layoutPixels(font, a);
	const second = layoutPixels(font, b);
	const gap = a && b ? (font.advance ?? 1) : 0;
	const width = first.width + gap + second.width;
	const fillA = inline ? 'currentColor' : brand.colors.ink;
	const fillB = inline ? `var(--brand-accent, ${brand.colors.accent})` : brand.colors.accent;
	const label = inline ? ' role="img" aria-label="' + esc(brand.name) + '"' : '';
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${rows}" shape-rendering="crispEdges" class="wordmark"${label}>` +
		`<path fill="${fillA}" d="${pixelPath(first.rects)}"/>` +
		(second.rects.length ? `<path fill="${fillB}" d="${pixelPath(second.rects, first.width + gap)}"/>` : '') +
		`</svg>`;
}

export function validate({ brand, mark, favicon, font }) {
	const errors = [];
	if (font) errors.push(...validatePixelFont(font, Array.isArray(brand.nameParts) ? brand.nameParts.join('') : ''));
	if (!brand.name) errors.push('name is required');
	if (!Array.isArray(brand.nameParts) || brand.nameParts.length !== 2 || brand.nameParts.join('') !== brand.name) {
		errors.push('nameParts must be two strings that join to name');
	}
	if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(brand.domain ?? '')) errors.push('domain must be a hostname');
	for (const [k, v] of Object.entries(brand.colors ?? {})) if (!HEX.test(v)) errors.push(`colors.${k} must be #rrggbb`);
	for (const [label, svg] of [['mark.svg', mark], ['favicon.svg', favicon]]) {
		if (!/^<svg[\s>]/.test(svg) || !/viewBox=/.test(svg)) errors.push(`${label} must be an <svg> with a viewBox`);
		if (/<script|\son[a-z]+\s*=|javascript:|<foreignObject/i.test(svg)) errors.push(`${label} contains active content`);
	}
	return errors;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function lockupSvg(data) {
	const { mark, font } = data;
	const nested = mark.replace(/^<svg/, '<svg x="0" y="0" width="64" height="64"').replace(/\sxmlns="[^"]*"/, '');
	// Mark is 64 tall; the wordmark's 7-row cap height is scaled to 36 units (first row at y=14).
	const word = wordmarkSvg(data, { inline: false });
	const [, , vw, vh] = /viewBox="0 0 (\d+) (\d+)"/.exec(word).map(Number);
	const scale = 36 / font.baseline;
	const width = Math.ceil(76 + vw * scale + 8);
	const inner = word.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 64">${nested}<g transform="translate(76 14) scale(${scale})" shape-rendering="crispEdges">${inner}</g></svg>\n`;
}

const HEADER = 'Generated by scripts/brand-sync.mjs from brand/. Do not edit; put overrides in brand/custom/.';

export function build(base = root) {
	const data = loadBrand(base);
	const errors = validate(data);
	if (errors.length) throw new Error(`Invalid brand:\n- ${errors.join('\n- ')}`);
	const { brand, mark, favicon, ico } = data;
	const files = new Map();
	const c = brand.colors;

	const publicBrand = {
		name: brand.name,
		nameParts: brand.nameParts,
		domain: brand.domain,
		tagline: brand.tagline,
		description: brand.description,
		oauthClientName: brand.oauthClientName,
		urls: brand.urls,
		colors: c,
		markSvg: mark,
		wordmarkSvg: wordmarkSvg(data)
	};

	files.set('ui/src/lib/brand/brand.generated.ts', `// ${HEADER}\nexport const brand = ${JSON.stringify(publicBrand, null, '\t')} as const;\n`);
	files.set('ui/src/lib/token/brand.generated.css', `/* ${HEADER} */\n:root {\n\t--brand-accent: ${c.accent};\n\t--green: ${c.primary};\n\t--green-hover: ${c.primaryHover};\n\t--green-deep: ${c.primaryDeep};\n}\n`);
	files.set('ui/static/favicon.svg', favicon + '\n');
	files.set('ui/static/logo.svg', lockupSvg(data));
	if (ico) files.set('ui/static/favicon.ico', ico);

	const metaBlock = `<!-- brand:start (${HEADER}) -->\n\t\t<meta name="application-name" content="${esc(brand.name)}" />\n\t\t<meta name="apple-mobile-web-app-title" content="${esc(brand.name)}" />\n\t\t<meta name="description" content="${esc(brand.description)}" />\n\t\t<!-- brand:end -->`;
	const appHtml = join(base, 'ui/src/app.html');
	let html = readFileSync(appHtml, 'utf8');
	html = html.replace(/<!-- brand:start[\s\S]*?<!-- brand:end -->/, metaBlock);
	files.set('ui/src/app.html', html);

	if (existsSync(join(base, 'landing/package.json'))) {
		files.set('landing/src/brand.generated.json', JSON.stringify(publicBrand, null, '\t') + '\n');
		files.set('landing/public/favicon.svg', favicon + '\n');
		if (ico) files.set('landing/public/favicon.ico', ico);
	}
	return files;
}

function main() {
	const files = build();
	let stale = 0;
	for (const [rel, content] of files) {
		const path = join(root, rel);
		const next = Buffer.isBuffer(content) ? content : Buffer.from(content);
		const current = existsSync(path) ? readFileSync(path) : null;
		const same = current && current.equals(next);
		if (checkOnly) {
			if (!same) { console.error(`stale: ${rel}`); stale++; }
			continue;
		}
		if (!same) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, next);
			console.log(`wrote ${rel}`);
		}
	}
	if (checkOnly && stale) {
		console.error('Run: node scripts/brand-sync.mjs');
		process.exit(1);
	}
	if (!checkOnly && !existsSync(join(root, 'landing/package.json'))) console.log('landing/ not pulled; skipped landing outputs');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
