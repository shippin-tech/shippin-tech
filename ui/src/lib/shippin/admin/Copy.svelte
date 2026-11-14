<script lang="ts">
	import { COPIED, COPY_BLOCKED, COPY_FAILED, copyLabel, writeClipboard } from '$lib/portal/copy';

	let { value, label = '' }: { value: string; label?: string } = $props();

	let state = $state<'idle' | 'copied' | 'blocked'>('idle');
	let timer: ReturnType<typeof setTimeout> | undefined;

	const name = $derived(state === 'copied' ? COPIED : copyLabel(label));

	async function onCopy() {
		const ok = await writeClipboard(value);
		if (timer) clearTimeout(timer);
		if (ok) {
			state = 'copied';
			timer = setTimeout(() => {
				state = 'idle';
			}, 1500);
		} else {
			state = 'blocked';
		}
	}
</script>

<button type="button" aria-label={name} onclick={onCopy}>{name}</button>
{#if state === 'blocked'}
	<p role="alert"><strong>{COPY_FAILED}</strong> {COPY_BLOCKED}</p>
{/if}

<style>
	button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
		cursor: pointer;
		white-space: nowrap;
	}
	button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	p {
		margin: 0;
		color: var(--color-danger);
	}
	@media (prefers-reduced-motion: reduce) {
		button { transition: none; }
	}
</style>
