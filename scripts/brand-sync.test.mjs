import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadBrand, loadPixelFont, validate, validatePixelFont, wordmarkSvg } from './brand-sync.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
	const dir = mkdtempSync(join(tmpdir(), 'brand-'));
	cpSync(join(repo, 'brand'), join(dir, 'brand'), { recursive: true });
	mkdirSync(join(dir, 'ui/src'), { recursive: true });
	cpSync(join(repo, 'ui/src/app.html'), join(dir, 'ui/src/app.html'));
	return dir;
}

test('defaults are the shippin.tech baseline', () => {
	const files = build(fixture());
	const ts = files.get('ui/src/lib/brand/brand.generated.ts');
	assert.match(ts, /"domain": "shippin.tech"/);
	const logo = files.get('ui/static/logo.svg');
	assert.match(logo, /<g transform="translate\(76 14\) scale\(/);
	// "S" starts one column in (".####"), so the first ink pixel sits at (1, 0).
	assert.match(logo, /fill="#0b1020" d="M1 0h1v1h-1zM2 0h1v1h-1z/);
	assert.match(logo, /fill="#22d3ee"/);
	assert.doesNotMatch(logo, /<text/);
});

test('wordmark is drawn from pixel glyphs with the accent on the second part', () => {
	const data = loadBrand(repo);
	const svg = wordmarkSvg(data);
	assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 \d+ 9" shape-rendering="crispEdges" class="wordmark" role="img" aria-label="ShippinTECH">/);
	assert.match(svg, /<path fill="currentColor" d="M/);
	assert.match(svg, /<path fill="var\(--brand-accent, #22d3ee\)" d="M/);
	assert.doesNotMatch(svg, /<text|font-family/);
	// "Shippin" is 7 glyphs of 5 columns with 1-column advance: 7*5 + 6 = 41; TECH is 4*5 + 3 = 23; plus 1 gap.
	assert.match(svg, /viewBox="0 0 65 9"/);
	// every glyph the name uses exists and the letter p carries a descender into rows 8-9
	assert.equal(validatePixelFont(data.font, data.brand.name).length, 0);
	assert.equal(data.font.glyphs.p.length, 9);
});

test('pixel font rejects missing glyphs and ragged rows', () => {
	const font = loadPixelFont(repo);
	assert.ok(validatePixelFont(font, 'Shippin TECH!').some((e) => e.includes('"!"')));
	const ragged = { ...font, glyphs: { ...font.glyphs, A: ['#####', '#.'] } };
	assert.ok(validatePixelFont(ragged, 'A').some((e) => e.includes('equal-length')));
	const dir = fixture();
	mkdirSync(join(dir, 'brand/custom'), { recursive: true });
	writeFileSync(join(dir, 'brand/custom/brand.json'), JSON.stringify({ name: 'Mail!', nameParts: ['Mail', '!'] }));
	assert.throws(() => build(dir), /no glyph for "!"/);
	rmSync(dir, { recursive: true, force: true });
});

test('brand/custom overrides manifest values and assets without touching defaults', () => {
	const dir = fixture();
	mkdirSync(join(dir, 'brand/custom'), { recursive: true });
	writeFileSync(join(dir, 'brand/custom/brand.json'), JSON.stringify({ name: 'AcmeMail', nameParts: ['Acme', 'Mail'], domain: 'acme.example', colors: { accent: '#ff0000' } }));
	mkdirSync(join(dir, 'brand/custom/assets'), { recursive: true });
	writeFileSync(join(dir, 'brand/custom/assets/mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
	const files = build(dir);
	const ts = files.get('ui/src/lib/brand/brand.generated.ts');
	assert.match(ts, /AcmeMail/);
	assert.match(ts, /<circle/);
	assert.match(files.get('ui/src/lib/token/brand.generated.css'), /--brand-accent: #ff0000/);
	assert.match(files.get('ui/src/app.html'), /content="AcmeMail"/);
	// untouched keys still come from the baseline
	assert.match(ts, /"sky": "#7dd3fc"/);
	assert.match(loadBrand(repo).brand.name, /ShippinTECH/);
	rmSync(dir, { recursive: true, force: true });
});

test('rejects bad names, colors and active SVG content', () => {
	const base = loadBrand(repo);
	assert.ok(validate({ ...base, brand: { ...base.brand, nameParts: ['A', 'B'] } }).some((e) => e.includes('nameParts')));
	assert.ok(validate({ ...base, brand: { ...base.brand, colors: { accent: 'red' } } }).some((e) => e.includes('colors.accent')));
	assert.ok(validate({ ...base, mark: '<svg viewBox="0 0 1 1"><script>x</script></svg>' }).some((e) => e.includes('active content')));
});
