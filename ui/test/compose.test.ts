import { describe, expect, it } from 'vitest';
import {
	draftProblem,
	draftRecord,
	emptyDraft,
	formatAddress,
	forwardDraft,
	parseAddresses,
	replyDraft,
	type Original
} from '../src/lib/mail/compose';

const original: Original = {
	id: 'm1',
	subject: 'Lunch plans',
	from: [{ name: 'Ann Lee', email: 'ann@example.com' }],
	to: [{ name: null, email: 'me@acme.test' }, { name: 'Bob', email: 'bob@example.org' }],
	cc: [{ name: null, email: 'cat@example.net' }, { name: null, email: 'ME@acme.test' }],
	replyTo: [],
	messageId: ['<abc@example.com>'],
	references: ['<root@example.com>'],
	receivedAt: '2026-11-10T12:00:00Z',
	body: 'Shall we meet at noon?\nAnn',
	attachments: [{ blobId: 'b1', name: 'menu.pdf', type: 'application/pdf', size: 2048 }]
};

describe('addresses', () => {
	it('parses names, quotes and separators', () => {
		const { addresses, invalid } = parseAddresses('Jane <jane@x.com>, bob@y.org; "Doe, John" <john@z.net>');
		expect(addresses).toEqual([
			{ name: 'Jane', email: 'jane@x.com' },
			{ name: null, email: 'bob@y.org' },
			{ name: 'Doe, John', email: 'john@z.net' }
		]);
		expect(invalid).toEqual([]);
	});

	it('reports what it cannot parse', () => {
		expect(parseAddresses('not-an-address, ok@x.com').invalid).toEqual(['not-an-address']);
		expect(parseAddresses('  ,  ').addresses).toEqual([]);
	});

	it('quotes display names that need it', () => {
		expect(formatAddress({ name: 'Doe, John', email: 'john@z.net' })).toBe('"Doe, John" <john@z.net>');
		expect(formatAddress({ name: null, email: 'a@b.co' })).toBe('a@b.co');
	});
});

describe('reply', () => {
	it('answers the sender, quotes the message and threads it', () => {
		const draft = replyDraft(original, 'me@acme.test');
		expect(draft.to).toBe('Ann Lee <ann@example.com>');
		expect(draft.cc).toBe('');
		expect(draft.subject).toBe('Re: Lunch plans');
		expect(draft.body).toContain('Ann Lee <ann@example.com> wrote:\n> Shall we meet at noon?\n> Ann');
		expect(draft.inReplyTo).toEqual(['<abc@example.com>']);
		expect(draft.references).toEqual(['<root@example.com>', '<abc@example.com>']);
		expect(draft.attachments).toEqual([]);
	});

	it('reply all copies everyone once and leaves you out', () => {
		const draft = replyDraft(original, 'me@acme.test', true);
		expect(draft.to).toBe('Ann Lee <ann@example.com>');
		expect(draft.cc).toBe('Bob <bob@example.org>, cat@example.net');
	});

	it('uses Reply-To when set and does not stack prefixes', () => {
		const draft = replyDraft({ ...original, subject: 'RE: Lunch', replyTo: [{ name: null, email: 'list@example.com' }] }, 'me@acme.test');
		expect(draft.to).toBe('list@example.com');
		expect(draft.subject).toBe('RE: Lunch');
	});

	it('replying to your own sent message goes to its recipients', () => {
		const sent = { ...original, from: [{ name: null, email: 'me@acme.test' }], to: [{ name: null, email: 'ann@example.com' }] };
		expect(replyDraft(sent, 'me@acme.test').to).toBe('ann@example.com');
	});
});

describe('forward', () => {
	it('keeps the attachments and includes the original headers', () => {
		const draft = forwardDraft(original);
		expect(draft.to).toBe('');
		expect(draft.subject).toBe('Fwd: Lunch plans');
		expect(draft.body).toContain('---------- Forwarded message ----------\nFrom: Ann Lee <ann@example.com>');
		expect(draft.body).toContain('Shall we meet at noon?');
		expect(draft.attachments).toEqual(original.attachments);
		expect(forwardDraft({ ...original, subject: 'Fw: x' }).subject).toBe('Fw: x');
	});
});

describe('draft checks and record', () => {
	it('needs a recipient to send but not to save', () => {
		expect(draftProblem(emptyDraft(), true)).toMatch(/recipient/);
		expect(draftProblem(emptyDraft(), false)).toBeNull();
		expect(draftProblem({ ...emptyDraft(), to: 'nope' }, false)).toMatch(/nope/);
	});

	it('builds the Email/set record the server stores', () => {
		const record = draftRecord(
			{ ...replyDraft(original, 'me@acme.test'), attachments: original.attachments },
			{ name: null, email: 'me@acme.test' },
			'drafts1'
		);
		expect(record.mailboxIds).toEqual({ drafts1: true });
		expect(record.keywords).toEqual({ $draft: true, $seen: true });
		expect(record.from).toEqual([{ name: null, email: 'me@acme.test' }]);
		expect(record.to).toEqual([{ name: 'Ann Lee', email: 'ann@example.com' }]);
		expect(record.textBody).toEqual([{ partId: 'body', type: 'text/plain' }]);
		expect((record.bodyValues as Record<string, { value: string }>).body.value).toContain('> Shall we meet');
		expect(record.attachments).toEqual([{ blobId: 'b1', name: 'menu.pdf', type: 'application/pdf', disposition: 'attachment' }]);
		expect(record.inReplyTo).toEqual(['<abc@example.com>']);
	});
});
