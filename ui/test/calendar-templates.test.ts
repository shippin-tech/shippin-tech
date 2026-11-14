import { describe, expect, it } from 'vitest';
import { templateLabel, templateProblem, templateVariables } from '../src/lib/shippin/calendar-templates/calendar-templates-call';

describe('calendar email helpers', () => {
	it('names each email', () => {
		expect(templateLabel('invite')).toBe('Invitation email');
		expect(templateLabel('alarm')).toBe('Reminder email');
	});

	it('finds the placeholders once each', () => {
		expect(templateVariables('<h1>{{page_title}}</h1>{{ header }}{{page_title}}')).toEqual(['page_title', 'header']);
		expect(templateVariables('no placeholders')).toEqual([]);
	});

	it('refuses an empty email', () => {
		expect(templateProblem('   ')).toMatch(/empty/);
		expect(templateProblem('<p>Hello</p>')).toBe('');
	});
});
