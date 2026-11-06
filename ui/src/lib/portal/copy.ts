export const COPY_FAILED = 'Copy failed';
export const COPY_BLOCKED =
	'Your browser blocked clipboard access. Select the value and copy it manually.';
export const COPIED = 'Copied';

export function copyLabel(name?: string): string {
	return name ? `Copy ${name}` : 'Copy';
}

export type ClipboardIo = {
	secure?: boolean;
	writeText?: (value: string) => Promise<void>;
	execCopy?: (value: string) => boolean;
};

export async function writeClipboard(value: string, io: ClipboardIo = {}): Promise<boolean> {
	const secure = io.secure ?? (typeof window === 'undefined' || window.isSecureContext !== false);
	const writeText = io.writeText ?? clipboardWrite();
	if (writeText && secure) {
		try {
			await writeText(value);
			return true;
		} catch {
			return (io.execCopy ?? execCopy)(value);
		}
	}
	return (io.execCopy ?? execCopy)(value);
}

function clipboardWrite(): ((value: string) => Promise<void>) | undefined {
	if (typeof navigator === 'undefined') return;
	const clipboard = navigator.clipboard;
	if (!clipboard?.writeText) return;
	return (value) => clipboard.writeText(value);
}

function execCopy(value: string): boolean {
	if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
	const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	const parent = active?.closest('[role="dialog"],[role="alertdialog"]') ?? document.body;
	const area = document.createElement('textarea');
	area.value = value;
	area.readOnly = true;
	area.setAttribute('aria-hidden', 'true');
	area.style.position = 'fixed';
	area.style.top = '0';
	area.style.left = '0';
	area.style.opacity = '0';
	area.style.pointerEvents = 'none';
	parent.appendChild(area);
	try {
		area.focus({ preventScroll: true });
		area.select();
		area.setSelectionRange(0, value.length);
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		area.remove();
		active?.focus({ preventScroll: true });
	}
}
