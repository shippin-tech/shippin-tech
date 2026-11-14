import { describe, expect, it } from 'vitest';
import { bodyOf, docFileName, docTitle, escapeHtml, exportName, isDocName, safeLink, titleProblem, wordDocument, wrapDocument } from '../src/lib/adapter/docs-call';

describe('Docs helpers', () => {
	it('names documents and reads titles back', () => {
		expect(docFileName(' Plan ')).toBe('Plan.shdoc.html');
		expect(docFileName('  ')).toBe('Untitled document.shdoc.html');
		expect(docTitle('Plan.shdoc.html')).toBe('Plan');
		expect(docTitle('notes.txt')).toBe('notes.txt');
		expect(isDocName('Plan.SHDOC.html')).toBe(true);
		expect(isDocName('page.html')).toBe(false);
	});

	it('checks titles with the same rules as file names', () => {
		expect(titleProblem('Fine title')).toBe('');
		expect(titleProblem('  ')).toContain('title');
		expect(titleProblem('a/b')).toContain('cannot contain');
	});

	it('stores a complete page and reads its body back', () => {
		const page = wrapDocument('A <b> title', '<p>Hello</p>');
		expect(page).toContain('<title>A &lt;b&gt; title</title>');
		expect(bodyOf(page)).toBe('<p>Hello</p>');
		expect(bodyOf('<p>no wrapper</p>')).toBe('<p>no wrapper</p>');
		expect(wordDocument('T', '<p>x</p>')).toContain('urn:schemas-microsoft-com:office:word');
		expect(escapeHtml('"<&>')).toBe('&quot;&lt;&amp;&gt;');
	});

	it('allows only web and mail links', () => {
		expect(safeLink('example.com')).toBe('https://example.com/');
		expect(safeLink('https://a.test/x')).toBe('https://a.test/x');
		expect(safeLink('mailto:a@b.test')).toBe('mailto:a@b.test');
		expect(safeLink('javascript:alert(1)')).toBeNull();
		expect(safeLink('data:text/html,x')).toBeNull();
		expect(safeLink('two words')).toBeNull();
		expect(safeLink('')).toBeNull();
	});

	it('makes export names files can have', () => {
		expect(exportName('Q3: plan/draft', 'html')).toBe('Q3  plan draft.html');
		expect(exportName('   ', 'doc')).toBe('Untitled document.doc');
	});
});
