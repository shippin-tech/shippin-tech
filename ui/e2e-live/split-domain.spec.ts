import { expect, test } from '@playwright/test';
import { createServer, connect, type Server, type Socket } from 'node:net';

// A domain shared with another mail system (RELEASE.md H1), on the local stack, with a
// stand-in for that system on the host (deploy/local/compose.yaml lists the domain).
const domain = 'split-domain.test';
const password = `Split check ${Math.random().toString(16).slice(2, 8)} pw`;
const owner = `owner@${domain}`;
const elsewhere = `colleague@${domain}`;
const base = process.env.LIVE_URL ?? 'http://127.0.0.1:28080';
const MAIL = ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail', 'urn:ietf:params:jmap:submission'];

type Received = { from: string; to: string[]; data: string };
const received: Received[] = [];
let server: Server;

function stand_in(socket: Socket) {
	let current: Received = { from: '', to: [], data: '' };
	let inData = false;
	let buffer = '';
	socket.write('220 stand-in ESMTP\r\n');
	socket.on('data', (chunk) => {
		buffer += chunk.toString();
		while (true) {
			if (inData) {
				const end = buffer.indexOf('\r\n.\r\n');
				if (end < 0) return;
				current.data = buffer.slice(0, end);
				buffer = buffer.slice(end + 5);
				inData = false;
				received.push(current);
				current = { from: '', to: [], data: '' };
				socket.write('250 2.0.0 queued\r\n');
				continue;
			}
			const newline = buffer.indexOf('\r\n');
			if (newline < 0) return;
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 2);
			const verb = line.slice(0, 4).toUpperCase();
			if (verb === 'EHLO' || verb === 'HELO') socket.write('250 stand-in\r\n');
			else if (verb === 'MAIL') {
				current.from = line;
				socket.write('250 2.1.0 ok\r\n');
			} else if (verb === 'RCPT') {
				current.to.push(/<([^>]+)>/.exec(line)?.[1] ?? '');
				socket.write('250 2.1.5 ok\r\n');
			} else if (verb === 'DATA') {
				inData = true;
				socket.write('354 go\r\n');
			} else if (verb === 'QUIT') {
				socket.write('221 bye\r\n');
				socket.end();
			} else socket.write('250 ok\r\n');
		}
	});
	socket.on('error', () => undefined);
}

function basic(user: string) {
	return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
}

async function api(method: string, path: string, user: string, body?: unknown) {
	return fetch(`${base}${path}`, {
		method,
		headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
}

async function jmap(user: string, calls: unknown[]) {
	const res = await api('POST', '/jmap', user, { using: MAIL, methodCalls: calls });
	return ((await res.json()) as { methodResponses: [string, Record<string, unknown>, string][] }).methodResponses;
}

/** One SMTP conversation with the server's public port; returns the reply to RCPT. */
function smtpFromTheInternet(rcpt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const socket = connect(21025, '127.0.0.1');
		const steps = ['EHLO outside.test', 'MAIL FROM:<sender@outside.test>', `RCPT TO:<${rcpt}>`];
		let replies = 0;
		let buffer = '';
		socket.on('error', reject);
		socket.on('data', (chunk) => {
			buffer += chunk.toString();
			const lines = buffer.split('\r\n');
			buffer = lines.pop() ?? '';
			for (const line of lines) {
				if (/^\d{3}-/.test(line)) continue;
				replies += 1;
				if (replies <= steps.length) socket.write(`${steps[replies - 1]}\r\n`);
				else {
					socket.end('QUIT\r\n');
					resolve(line);
				}
			}
		});
	});
}

async function send(to: string, subject: string) {
	const session = (await (await api('GET', '/jmap/session', owner)).json()) as { primaryAccounts: Record<string, string> };
	const account = session.primaryAccounts['urn:ietf:params:jmap:mail'];
	const mailboxes = await jmap(owner, [['Mailbox/get', { accountId: account, properties: ['id', 'role'] }, 'm'], ['Identity/get', { accountId: account }, 'i']]);
	const drafts = (mailboxes[0][1].list as { id: string; role: string }[]).find((box) => box.role === 'drafts')!.id;
	const identity = (mailboxes[1][1].list as { id: string }[])[0].id;
	return jmap(owner, [
		[
			'Email/set',
			{
				accountId: account,
				create: {
					d: {
						mailboxIds: { [drafts]: true },
						from: [{ email: owner }],
						to: [{ email: to }],
						subject,
						textBody: [{ partId: 'b', type: 'text/plain' }],
						bodyValues: { b: { value: 'Hello across systems.' } }
					}
				}
			},
			'e'
		],
		['EmailSubmission/set', { accountId: account, create: { s: { emailId: '#d', identityId: identity } } }, 's']
	]);
}

test.beforeAll(async () => {
	server = createServer(stand_in);
	await new Promise<void>((resolve) => server.listen(28025, '0.0.0.0', resolve));
});

test.afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
	await api('POST', '/api/panel/domain/close', owner, { confirm: domain });
});

test('a shared domain reaches the other system for signed-in senders only, with no loop', async () => {
	test.setTimeout(120_000);
	const created = await fetch(`${base}/api/panel/signup`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ domain, name: 'owner', password })
	});
	expect(created.status).toBe(200);

	// From the internet, an address nobody here holds is refused: nothing to loop.
	expect(await smtpFromTheInternet(elsewhere)).toMatch(/^550/);
	expect(await smtpFromTheInternet(owner)).toMatch(/^250/);

	// A signed-in person writing to a colleague on the other system gets through.
	const subject = `To the other system ${Math.random().toString(16).slice(2, 8)}`;
	const sent = await send(elsewhere, subject);
	expect(sent[1][1].created).toBeTruthy();
	await expect.poll(() => received.find((item) => item.data.includes(subject))?.to, { timeout: 60_000 }).toEqual([elsewhere]);

	// Someone who lives here still gets their mail here, not over there.
	const local = `Stays here ${Math.random().toString(16).slice(2, 8)}`;
	await send(owner, local);
	const session = (await (await api('GET', '/jmap/session', owner)).json()) as { primaryAccounts: Record<string, string> };
	const account = session.primaryAccounts['urn:ietf:params:jmap:mail'];
	await expect
		.poll(
			async () => {
				const found = await jmap(owner, [['Email/query', { accountId: account, filter: { subject: local, inMailbox: undefined } }, 'q']]);
				return (found[0][1].ids as string[]).length;
			},
			{ timeout: 60_000 }
		)
		.toBeGreaterThan(0);
	expect(received.find((item) => item.data.includes(local))).toBeUndefined();
});
