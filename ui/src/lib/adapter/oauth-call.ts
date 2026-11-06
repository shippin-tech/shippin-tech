export function exchangeFailed(status: number, statusText: string): string {
	return `Token exchange failed: ${status} ${statusText}`;
}
