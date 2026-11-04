import { accountId, idsOf, jmap, listOf } from './jmap';

const MAIL = 'urn:ietf:params:jmap:mail';

export type Folder = {
	id: string;
	name: string;
	role: string | null;
	total: number;
	unread: number;
};

export type Message = {
	id: string;
	subject: string;
	preview: string;
	from: string;
	receivedAt: string;
};

type MailboxRow = {
	id?: string;
	name?: string;
	role?: string | null;
	totalEmails?: number;
	unreadEmails?: number;
	sortOrder?: number;
};

type Address = { name?: string | null; email?: string | null };

type EmailRow = {
	id?: string;
	subject?: string | null;
	preview?: string | null;
	from?: Address[] | null;
	receivedAt?: string | null;
};

const mailboxProperties = ['id', 'name', 'role', 'sortOrder', 'totalEmails', 'unreadEmails'];
const emailProperties = ['id', 'subject', 'preview', 'from', 'receivedAt', 'mailboxIds'];

function folder(row: MailboxRow): Folder {
	return {
		id: String(row.id ?? ''),
		name: row.name || 'Mailbox',
		role: row.role ?? null,
		total: row.totalEmails ?? 0,
		unread: row.unreadEmails ?? 0
	};
}

function who(from: Address[] | null | undefined): string {
	const first = from?.[0];
	if (!first) return '';
	return first.name || first.email || '';
}

function message(row: EmailRow): Message {
	return {
		id: String(row.id ?? ''),
		subject: row.subject || '(no subject)',
		preview: row.preview || '',
		from: who(row.from),
		receivedAt: row.receivedAt || ''
	};
}

export async function loadFolders(): Promise<Folder[]> {
	const responses = await jmap(
		[MAIL],
		[['Mailbox/get', { accountId: accountId(), properties: mailboxProperties }, 'm0']]
	);
	return listOf<MailboxRow>(responses, 'Mailbox/get')
		.map(folder)
		.filter((item) => item.id)
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadMessages(mailboxId: string): Promise<Message[]> {
	const queried = await jmap(
		[MAIL],
		[
			[
				'Email/query',
				{
					accountId: accountId(),
					filter: { inMailbox: mailboxId },
					sort: [{ property: 'receivedAt', isAscending: false }],
					limit: 50
				},
				'q0'
			]
		]
	);
	const ids = idsOf(queried, 'Email/query');
	if (!ids.length) return [];
	const fetched = await jmap(
		[MAIL],
		[['Email/get', { accountId: accountId(), ids, properties: emailProperties }, 'e0']]
	);
	const byId = new Map(listOf<EmailRow>(fetched, 'Email/get').map((row) => [String(row.id), message(row)]));
	return ids.map((id) => byId.get(id)).filter((row): row is Message => Boolean(row));
}

export async function loadMessage(id: string): Promise<Message | null> {
	const fetched = await jmap(
		[MAIL],
		[['Email/get', { accountId: accountId(), ids: [id], properties: emailProperties }, 'e0']]
	);
	const row = listOf<EmailRow>(fetched, 'Email/get')[0];
	return row ? message(row) : null;
}
