import { accountId, jmap, listOf, type MethodResponse } from './jmap';
import { account, authorization } from './session';
import { loadFolders } from './mail';
import { draftRecord, type Address, type Attachment, type Draft, type Original } from '$lib/mail/compose';

const MAIL = 'urn:ietf:params:jmap:mail';
const SUBMISSION = 'urn:ietf:params:jmap:submission';

type RawAddress = { name?: string | null; email?: string | null };
type FullRow = {
	id?: string;
	subject?: string | null;
	from?: RawAddress[] | null;
	to?: RawAddress[] | null;
	cc?: RawAddress[] | null;
	replyTo?: RawAddress[] | null;
	messageId?: string[] | null;
	references?: string[] | null;
	receivedAt?: string | null;
	attachments?: { blobId?: string; name?: string | null; type?: string | null; size?: number }[] | null;
	keywords?: Record<string, boolean> | null;
	textBody?: { partId?: string | null }[] | null;
	bodyValues?: Record<string, { value?: string; isTruncated?: boolean }> | null;
};

const addresses = (list: RawAddress[] | null | undefined): Address[] =>
	(list ?? []).filter((a) => !!a?.email).map((a) => ({ name: a.name ?? null, email: String(a.email) }));

function payloadOf(responses: MethodResponse[], name: string): Record<string, unknown> {
	return (responses.find(([method]) => method === name)?.[1] as Record<string, unknown> | undefined) ?? {};
}

function created(payload: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
	return (payload.created as Record<string, Record<string, unknown>> | undefined)?.[key];
}

/** Reads why the server refused a create, in the words it gave. */
export function refusal(payload: Record<string, unknown>, key: string, fallback: string): string {
	const error = (payload.notCreated as Record<string, { description?: unknown; type?: unknown }> | undefined)?.[key];
	if (error && typeof error.description === 'string') return error.description;
	if (error && typeof error.type === 'string') return `${fallback} (${error.type})`;
	return fallback;
}

/** Everything reply, forward and the reader need about one message. Marks it read. */
export async function loadOriginal(id: string): Promise<(Original & { draft: boolean; truncated: boolean }) | null> {
	const responses = await jmap(
		[MAIL],
		[
			[
				'Email/get',
				{
					accountId: accountId(),
					ids: [id],
					properties: ['id', 'subject', 'from', 'to', 'cc', 'replyTo', 'messageId', 'references', 'receivedAt', 'attachments', 'keywords', 'textBody', 'bodyValues'],
					fetchTextBodyValues: true,
					maxBodyValueBytes: 1_000_000
				},
				'e0'
			]
		]
	);
	const row = listOf<FullRow>(responses, 'Email/get')[0];
	if (!row) return null;
	if (!row.keywords?.$seen) {
		await jmap([MAIL], [['Email/set', { accountId: accountId(), update: { [id]: { 'keywords/$seen': true } } }, 's0']]).catch(() => undefined);
	}
	const parts = (row.textBody ?? [])
		.map((part) => (part.partId ? row.bodyValues?.[part.partId] : undefined))
		.filter((value): value is { value: string; isTruncated?: boolean } => typeof value?.value === 'string');
	return {
		id,
		subject: row.subject || '',
		from: addresses(row.from),
		to: addresses(row.to),
		cc: addresses(row.cc),
		replyTo: addresses(row.replyTo),
		messageId: row.messageId ?? [],
		references: row.references ?? [],
		receivedAt: row.receivedAt || '',
		body: parts.length ? parts.map((part) => part.value).join('\n\n') : null,
		truncated: parts.some((part) => part.isTruncated === true),
		attachments: (row.attachments ?? [])
			.filter((a) => a.blobId)
			.map((a) => ({ blobId: String(a.blobId), name: a.name || 'attachment', type: a.type || 'application/octet-stream', size: a.size ?? 0 })),
		draft: row.keywords?.$draft === true
	};
}

/** The folders that sending needs. Missing ones are reported, not invented. */
export async function specialFolders(): Promise<{ drafts: string; sent: string }> {
	const folders = await loadFolders();
	const drafts = folders.find((f) => f.role === 'drafts')?.id;
	const sent = folders.find((f) => f.role === 'sent')?.id;
	if (!drafts || !sent) throw new Error('This mailbox has no Drafts or Sent folder.');
	return { drafts, sent };
}

/** The account's sending identity, created on first use. */
export async function senderIdentity(): Promise<{ id: string; from: Address }> {
	const email = account()?.username ?? '';
	const responses = await jmap([MAIL, SUBMISSION], [['Identity/get', { accountId: accountId() }, 'i0']]);
	const list = listOf<{ id?: string; name?: string | null; email?: string }>(responses, 'Identity/get');
	const match = list.find((i) => i.email?.toLowerCase() === email.toLowerCase()) ?? list[0];
	if (match?.id && match.email) return { id: String(match.id), from: { name: match.name || null, email: String(match.email) } };
	const made = await jmap([MAIL, SUBMISSION], [['Identity/set', { accountId: accountId(), create: { me: { name: '', email } } }, 'i1']]);
	const payload = payloadOf(made, 'Identity/set');
	const id = created(payload, 'me')?.id;
	if (typeof id !== 'string') throw new Error(refusal(payload, 'me', 'No sending identity could be created.'));
	return { id, from: { name: null, email } };
}

export async function saveDraft(draft: Draft): Promise<string> {
	const [{ drafts }, identity] = await Promise.all([specialFolders(), senderIdentity()]);
	const call: Record<string, unknown> = { accountId: accountId(), create: { draft: draftRecord(draft, identity.from, drafts) } };
	if (draft.draftId) call.destroy = [draft.draftId];
	const payload = payloadOf(await jmap([MAIL], [['Email/set', call, 'd0']]), 'Email/set');
	const id = created(payload, 'draft')?.id;
	if (typeof id !== 'string') throw new Error(refusal(payload, 'draft', 'The draft was not saved.'));
	return id;
}

/** Stores the message, submits it, and on success moves it from Drafts to Sent. */
export async function sendDraft(draft: Draft): Promise<void> {
	const [{ drafts, sent }, identity] = await Promise.all([specialFolders(), senderIdentity()]);
	const store: Record<string, unknown> = { accountId: accountId(), create: { draft: draftRecord(draft, identity.from, drafts) } };
	if (draft.draftId) store.destroy = [draft.draftId];
	const responses = await jmap(
		[MAIL, SUBMISSION],
		[
			['Email/set', store, 'd0'],
			[
				'EmailSubmission/set',
				{
					accountId: accountId(),
					create: { send: { identityId: identity.id, emailId: '#draft' } },
					onSuccessUpdateEmail: {
						'#send': { [`mailboxIds/${drafts}`]: null, [`mailboxIds/${sent}`]: true, 'keywords/$draft': null }
					}
				},
				's0'
			]
		]
	);
	const stored = payloadOf(responses, 'Email/set');
	if (!created(stored, 'draft')) throw new Error(refusal(stored, 'draft', 'The message could not be prepared.'));
	const submitted = payloadOf(responses, 'EmailSubmission/set');
	if (!created(submitted, 'send')) throw new Error(refusal(submitted, 'send', 'The message was saved in Drafts but not sent.'));
}

export async function uploadAttachment(file: File): Promise<Attachment> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const res = await fetch(`/jmap/upload/${encodeURIComponent(accountId())}/`, {
		method: 'POST',
		credentials: 'same-origin',
		headers: { Authorization: auth, 'Content-Type': file.type || 'application/octet-stream' },
		body: file
	});
	const body = (await res.json().catch(() => ({}))) as { blobId?: string; size?: number; type?: string; detail?: string };
	if (!res.ok || !body.blobId) {
		throw new Error(res.status === 413 ? `${file.name} is too large to attach.` : body.detail || `${file.name} could not be uploaded.`);
	}
	return { blobId: body.blobId, name: file.name, type: file.type || body.type || 'application/octet-stream', size: body.size ?? file.size };
}

/** Downloads with the session's credentials, which a plain link cannot carry. */
export async function downloadAttachment(attachment: Attachment): Promise<void> {
	const auth = authorization();
	if (!auth) throw new Error('sign-in required');
	const path = [accountId(), attachment.blobId, attachment.name].map(encodeURIComponent).join('/');
	const res = await fetch(`/jmap/download/${path}?accept=${encodeURIComponent(attachment.type)}`, {
		credentials: 'same-origin',
		headers: { Authorization: auth }
	});
	if (!res.ok) throw new Error(`${attachment.name} could not be downloaded.`);
	const link = document.createElement('a');
	link.href = URL.createObjectURL(await res.blob());
	link.download = attachment.name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
