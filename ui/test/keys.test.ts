import { describe, expect, it } from 'vitest';
import { KEY_GUIDES, WHY_HERE } from '../src/lib/shippin/keys/keys';
import { variants } from '../src/lib/shippin/keys/variants';

describe('what people are told about their keys', () => {
	it('covers every key, each with where it comes from, how it is kept and its proof', () => {
		for (const id of variants) {
			const guide = KEY_GUIDES[id];
			expect(guide.id).toBe(id);
			const labels = guide.facts.map((fact) => fact.label);
			expect(labels).toContain('Where it comes from');
			expect(labels).toContain('How it is kept');
			expect(guide.proof).toMatch(/test/);
		}
	});

	it('says plainly that the field is the right place, or where a made key goes', () => {
		for (const id of variants) {
			expect(KEY_GUIDES[id].title).toMatch(/This is the right place for it\.|was made for you\. Paste it into/);
		}
		expect(WHY_HERE).toMatch(/never share a key/);
		expect(WHY_HERE).toMatch(/Each one is tested\./);
	});

	it('names the random source and size of every key this server makes', () => {
		for (const id of variants.filter((v) => KEY_GUIDES[v].origin === 'generated')) {
			const from = KEY_GUIDES[id].facts.find((fact) => fact.label === 'Where it comes from')!.text;
			expect(from).toMatch(/This server made it/);
			expect(from).toMatch(/\d+ (characters|bytes) from a secure random generator/);
		}
	});

	it('tells people bringing their own key that it cannot be sent anywhere else', () => {
		for (const id of variants.filter((v) => KEY_GUIDES[v].origin === 'yours')) {
			const goes = KEY_GUIDES[id].facts.find((fact) => fact.label === 'Where it goes')!.text;
			expect(goes).toMatch(/Redirects are refused/);
		}
	});
});
