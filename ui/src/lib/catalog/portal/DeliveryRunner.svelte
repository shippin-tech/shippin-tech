<script lang="ts">
	import {
		DELIVERY_SUBTITLE,
		DELIVERY_TITLE,
		FAILED_START,
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
		onstart
	}: {
		stages?: readonly DeliveryStage[];
		onstart?: (target: string) => void;
	} = $props();

	let target = $state('');
	let notice = $state('');

	function start() {
		notice = '';
		if (!validTarget(target)) {
			notice = INVALID_TARGET;
			return;
		}
		if (onstart) onstart(target.trim());
		else notice = FAILED_START;
	}
</script>

<section class="runner">
	<h2>{DELIVERY_TITLE}</h2>
	<p>{DELIVERY_SUBTITLE}</p>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			start();
		}}
	>
		<label>
			{TARGET_LABEL}
			<input name="target" placeholder={TARGET_PLACEHOLDER} bind:value={target} />
		</label>
		<button type="submit">{START_TRACE}</button>
	</form>
	{#if notice}<p role="status">{notice}</p>{/if}
	{#if stages.length}
		<ol>
			{#each stages as stage, index (`${stage.type}-${index}`)}
				<li data-tone={stageTone(stage.type)}>{phaseLabel(stage.type)}</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	.runner { display: grid; gap: var(--y-2xs); }
	h2, p { margin: 0; }
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
