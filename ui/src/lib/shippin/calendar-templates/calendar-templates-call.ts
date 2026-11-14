/** Pure helpers for the calendar emails; the calls are in shippin/calendar-templates/calendar-templates.ts. */

export type CalendarTemplate = { id: 'invite' | 'alarm'; builtIn: string; custom: string | null };

export function templateLabel(id: CalendarTemplate['id']): string {
	return id === 'invite' ? 'Invitation email' : 'Reminder email';
}

/** The placeholders a template can use, in the order they first appear. */
export function templateVariables(source: string): string[] {
	const found = new Set<string>();
	for (const match of source.matchAll(/\{\{\s*([#/!]?)\s*(?:if\s+|for\s+)?([a-z_]+)\s*\}\}/g)) {
		if (match[1] !== '/') found.add(match[2]);
	}
	for (const word of ['if', 'for', 'end']) found.delete(word);
	return [...found];
}

export function templateProblem(source: string): string {
	return source.trim() === '' ? 'The template is empty.' : '';
}
