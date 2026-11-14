/** Pure compose logic for webmail: addresses, reply and forward drafts, the JMAP draft record. */

export type Address = { name: string | null; email: string };

export type Attachment = { blobId: string; name: string; type: string; size: number };

/** What the reader knows about a message, enough to reply to or forward it. */
export type Original = {
	id: string;
	subject: string;
	from: Address[];
	to: Address[];
	cc: Address[];
	replyTo: Address[];
	messageId: string[];
	references: string[];
	receivedAt: string;
	body: string | null;
	attachments: Attachment[];
};

export type Draft = {
	to: string;
	cc: string;
	subject: string;
	body: string;
	attachments: Attachment[];
	inReplyTo: string[];
	references: string[];
	/** Draft being edited, replaced on save or send. */
	draftId: string | null;
};

export const emptyDraft = (): Draft => ({
	to: '',
	cc: '',
	subject: '',
	body: '',
	attachments: [],
	inReplyTo: [],
	references: [],
	draftId: null
});

const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function formatAddress(address: Address): string {
	if (!address.name) return address.email;
	const name = /[",<>@]/.test(address.name) ? `"${address.name.replace(/"/g, '\\"')}"` : address.name;
	return `${name} <${address.email}>`;
}

export function formatAddresses(list: Address[]): string {
	return list.map(formatAddress).join(', ');
}

/** Splits "Jane <jane@x.com>, bob@y.org" into addresses. Commas inside quotes stay in the name. */
export function parseAddresses(input: string): { addresses: Address[]; invalid: string[] } {
	const parts: string[] = [];
	let current = '';
	let quoted = false;
	for (const char of input) {
		if (char === '"') quoted = !quoted;
		if ((char === ',' || char === ';') && !quoted) {
			parts.push(current);
			current = '';
		} else current += char;
	}
	parts.push(current);
	const addresses: Address[] = [];
	const invalid: string[] = [];
	for (const raw of parts.map((part) => part.trim()).filter(Boolean)) {
		const angled = /^(.*)<([^<>]+)>$/.exec(raw);
		const email = (angled ? angled[2] : raw).trim();
		const name = angled ? angled[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"') || null : null;
		if (EMAIL.test(email)) addresses.push({ name, email });
		else invalid.push(raw);
	}
	return { addresses, invalid };
}

function prefixed(subject: string, prefix: 'Re' | 'Fwd'): string {
	const clean = subject.trim() || '(no subject)';
	const pattern = prefix === 'Re' ? /^re:/i : /^(fwd?|fw):/i;
	return pattern.test(clean) ? clean : `${prefix}: ${clean}`;
}

function quote(original: Original): string {
	const when = original.receivedAt ? new Date(original.receivedAt).toUTCString() : 'an earlier date';
	const who = original.from[0] ? formatAddress(original.from[0]) : 'the sender';
	const lines = (original.body ?? '').split(/\r?\n/).map((line) => `> ${line}`);
	return `\n\nOn ${when}, ${who} wrote:\n${lines.join('\n')}\n`;
}

const sameAddress = (a: Address, b: Address) => a.email.toLowerCase() === b.email.toLowerCase();

/** Reply to the sender (Reply-To wins), or to everyone except yourself for reply all. */
export function replyDraft(original: Original, self: string, all = false): Draft {
	const me: Address = { name: null, email: self };
	const target = original.replyTo.length ? original.replyTo : original.from;
	let to = target.filter((a) => !sameAddress(a, me));
	if (to.length === 0) to = original.to.filter((a) => !sameAddress(a, me));
	let cc: Address[] = [];
	if (all) {
		const seen = [...to, me];
		cc = [...original.to, ...original.cc].filter((a) => {
			if (seen.some((s) => sameAddress(s, a))) return false;
			seen.push(a);
			return true;
		});
	}
	return {
		...emptyDraft(),
		to: formatAddresses(to),
		cc: formatAddresses(cc),
		subject: prefixed(original.subject, 'Re'),
		body: quote(original),
		inReplyTo: original.messageId,
		references: [...original.references, ...original.messageId]
	};
}

export function forwardDraft(original: Original): Draft {
	const header = [
		'---------- Forwarded message ----------',
		`From: ${formatAddresses(original.from)}`,
		`Date: ${original.receivedAt ? new Date(original.receivedAt).toUTCString() : ''}`,
		`Subject: ${original.subject}`,
		`To: ${formatAddresses(original.to)}`
	];
	if (original.cc.length) header.push(`Cc: ${formatAddresses(original.cc)}`);
	return {
		...emptyDraft(),
		subject: prefixed(original.subject, 'Fwd'),
		body: `\n\n${header.join('\n')}\n\n${original.body ?? ''}\n`,
		attachments: original.attachments
	};
}

export type DraftProblem = string | null;

export function draftProblem(draft: Draft, sending: boolean): DraftProblem {
	const to = parseAddresses(draft.to);
	const cc = parseAddresses(draft.cc);
	const invalid = [...to.invalid, ...cc.invalid];
	if (invalid.length) return `Check these addresses: ${invalid.join(', ')}`;
	if (sending && to.addresses.length + cc.addresses.length === 0) return 'Add at least one recipient.';
	return null;
}

/** The Email/set create object for a draft. The caller supplies the folder and sender. */
export function draftRecord(draft: Draft, from: Address, draftsId: string): Record<string, unknown> {
	const record: Record<string, unknown> = {
		mailboxIds: { [draftsId]: true },
		keywords: { $draft: true, $seen: true },
		from: [from],
		to: parseAddresses(draft.to).addresses,
		cc: parseAddresses(draft.cc).addresses,
		subject: draft.subject,
		bodyValues: { body: { value: draft.body } },
		textBody: [{ partId: 'body', type: 'text/plain' }],
		attachments: draft.attachments.map((a) => ({ blobId: a.blobId, name: a.name, type: a.type, disposition: 'attachment' }))
	};
	if (draft.inReplyTo.length) record.inReplyTo = draft.inReplyTo;
	if (draft.references.length) record.references = draft.references;
	return record;
}
