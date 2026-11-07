<script lang="ts">
	import {
		DELIVERY_SUBTITLE,
		DELIVERY_TITLE,
		INVALID_TARGET,
		START_TRACE,
		TARGET_LABEL,
		TARGET_PLACEHOLDER,
		phaseLabel,
		stageTone,
		validTarget,
		type DeliveryStage
	} from '$lib/portal/delivery';

	let {
		stages = [],
		phase = 'idle',
		notice = '',
		onstart,
		onstop
	}: {
		stages?: readonly DeliveryStage[];
		phase?: 'idle' | 'connecting' | 'running' | 'completed' | 'cancelled' | 'failed';
		notice?: string;
		onstart: (target: string) => void;
		onstop: () => void;
	} = $props();

	let target = $state('');
	let validation = $state('');
	const busy = $derived(phase === 'connecting' || phase === 'running');

	function start() {
		validation = '';
		if (!validTarget(target)) {
			validation = INVALID_TARGET;
			return;
		}
		onstart(target.trim());
	}
</script>

<section class="runner">
	<h1>{DELIVERY_TITLE}</h1>
	<p>{DELIVERY_SUBTITLE}</p>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			start();
		}}
	>
		<label>
			{TARGET_LABEL}
			<input name="target" placeholder={TARGET_PLACEHOLDER} bind:value={target} disabled={busy} />
		</label>
		<button type="submit" disabled={busy}>{START_TRACE}</button>
		{#if busy}<button type="button" onclick={onstop}>Cancel trace</button>{/if}
	</form>
	{#if validation}<p role="alert">{validation}</p>{/if}
	{#if notice}<p role={phase === 'failed' ? 'alert' : 'status'}>{notice}</p>{/if}
	{#if stages.length}
		<ol>
			{#each stages as stage, index (`${stage.type}-${index}`)}
				<li data-tone={stageTone(stage.type)}><details><summary>{phaseLabel(stage.type)}: {stage.type}</summary><pre>{JSON.stringify(stage, null, 2)}</pre></details></li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.runner { display: grid; gap: var(--y-2xs); }
	h1, p { margin: 0; }
	form { display: grid; gap: var(--y-2xs); justify-items: start; }
	label { display: grid; gap: var(--y-3xs); }
	input, button {
		font: inherit;
		min-height: 2.75rem;
		padding: var(--y-2xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-input);
		color: var(--color-text);
	}
	button { background: var(--color-card); cursor: pointer; }
	ol { margin: 0; padding-inline-start: var(--x-s); }
	li[data-tone='error'] { color: var(--color-danger); }
	input:focus-visible, button:focus-visible {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
</style>
