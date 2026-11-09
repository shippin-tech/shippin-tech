import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadBrand, validate } from './brand-sync.mjs';

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
	assert.match(files.get('ui/static/logo.svg'), /Shippin<\/tspan>/);
});

test('brand/custom overrides manifest values and assets without touching defaults', () => {
	const dir = fixture();
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
