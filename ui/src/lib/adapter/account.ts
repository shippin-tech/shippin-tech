import { jmap } from './jmap';
import { authorization, account, openSession } from './session';

const USING = ['urn:shippin.tech:jmap'];

export type AppPassword = { id: string; description: string; createdAt: string | null; expiresAt: string | null };

function result(responses: [string, Record<string, unknown>, string][], name: string): Record<string, unknown> {
	return responses.find(([method]) => method === name)?.[1] ?? {};
}

function reason(error: unknown, fallback: string): string {
	if (error && typeof error === 'object') {
		const e = error as { description?: unknown; type?: unknown };
		if (typeof e.description === 'string') return e.description;
		if (e.type === 'overQuota') return 'You have reached the limit for this account.';
	}
	return fallback;
}

/** Whether two-factor sign-in is on. The server masks the secret but keeps the field set. */
export async function loadTwoFactor(): Promise<boolean> {
	const responses = await jmap(USING, [['x:AccountPassword/get', { ids: ['singleton'] }, 'g']]);
	const record = ((result(responses, 'x:AccountPassword/get').list as Record<string, unknown>[] | undefined) ?? [])[0];
	const otp = (record?.otpAuth ?? {}) as { otpUrl?: unknown };
	return typeof otp.otpUrl === 'string' && otp.otpUrl.length > 0;
}

/**
 * Field-level patch on the password record. Sending "otpAuth" as a whole object would
 * clear the stored authenticator, which the server reads as "turn two-factor off".
 */
async function updatePassword(patch: Record<string, unknown>): Promise<void> {
	const responses = await jmap(USING, [['x:AccountPassword/set', { update: { singleton: patch } }, 's']]);
	const payload = result(responses, 'x:AccountPassword/set');
	const updated = payload.updated as Record<string, unknown> | undefined;
	if (updated && 'singleton' in updated) return;
	const notUpdated = (payload.notUpdated as Record<string, unknown> | undefined)?.singleton;
	throw new Error(reason(notUpdated, 'The change was not saved.'));
}

export async function changePassword(current: string, next: string, code: string): Promise<void> {
	const patch: Record<string, unknown> = { secret: next, currentSecret: current };
	if (code) patch['otpAuth/otpCode'] = code;
	await updatePassword(patch);
	// A Basic session carries the old password; reopen it so the page keeps working.
	const who = account();
	if (who && authorization()?.startsWith('Basic ')) await openSession(who.username, next);
}

export const enableTwoFactor = (current: string, otpUrl: string) =>
	updatePassword({ currentSecret: current, 'otpAuth/otpUrl': otpUrl });

export const disableTwoFactor = (current: string, code: string) =>
	updatePassword({ currentSecret: current, 'otpAuth/otpCode': code, 'otpAuth/otpUrl': null });

export async function loadAppPasswords(): Promise<AppPassword[]> {
	const responses = await jmap(USING, [
		['x:AppPassword/query', {}, 'q'],
		[
			'x:AppPassword/get',
			{
				'#ids': { resultOf: 'q', name: 'x:AppPassword/query', path: '/ids' },
				properties: ['id', 'description', 'createdAt', 'expiresAt']
			},
			'g'
		]
	]);
	const list = (result(responses, 'x:AppPassword/get').list as Record<string, unknown>[] | undefined) ?? [];
	return list.map((item) => ({
		id: String(item.id),
		description: typeof item.description === 'string' ? item.description : '',
		createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
		expiresAt: typeof item.expiresAt === 'string' ? item.expiresAt : null
	}));
}

/** Returns the generated secret. The server shows it once and stores only a hash. */
export async function createAppPassword(description: string): Promise<string> {
	const responses = await jmap(USING, [['x:AppPassword/set', { create: { a: { description } } }, 's']]);
	const payload = result(responses, 'x:AppPassword/set');
	const created = (payload.created as Record<string, { secret?: unknown }> | undefined)?.a;
	if (created && typeof created.secret === 'string') return created.secret;
	throw new Error(reason((payload.notCreated as Record<string, unknown> | undefined)?.a, 'The app password was not created.'));
}

export async function revokeAppPassword(id: string): Promise<void> {
	const responses = await jmap(USING, [['x:AppPassword/set', { destroy: [id] }, 's']]);
	const payload = result(responses, 'x:AppPassword/set');
	if (((payload.destroyed as string[] | undefined) ?? []).includes(id)) return;
	throw new Error(reason((payload.notDestroyed as Record<string, unknown> | undefined)?.[id], 'The app password was not revoked.'));
}
