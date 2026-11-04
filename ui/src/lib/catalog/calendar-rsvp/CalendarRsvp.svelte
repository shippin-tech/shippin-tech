<script lang="ts">
	import { partStats, type PartStat, type RsvpVariant } from './variants';

	type Person = { name?: string; email?: string };

	type Props = {
		variant: RsvpVariant;
		summary: string;
		organizer: string;
		when: string;
		recurrence: string;
		location: string;
		description: string;
		conference: string;
		conferenceUrl: string;
		attendees: Person[];
		selected: PartStat | '';
		note: string;
		alert: string;
		pending: boolean;
		recorded: string;
		onselect: (value: PartStat) => void;
		onsend: () => void;
		onchange: () => void;
	};

	let {
		variant,
		summary,
		organizer,
		when,
		recurrence,
		location,
		description,
		conference,
		conferenceUrl,
		attendees,
		selected = $bindable(''),
		note = $bindable(''),
		alert,
		pending,
		recorded,
		onselect,
		onsend,
		onchange
	}: Props = $props();

	const labels: Record<PartStat, string> = {
		accepted: 'Yes',
		tentative: 'Maybe',
		declined: 'No'
	};
</script>

<article class="card">
	<p class="eyebrow">{variant}</p>
	<h1>{summary || 'Invitation'}</h1>
	{#if organizer}<p class="sub">Organizer: {organizer}</p>{/if}
	{#if when}<p>When: {when}</p>{/if}
	{#if recurrence}<p>Repeat: {recurrence}</p>{/if}
	{#if location}<p>Where: {location}</p>{/if}
	{#if conference}
		<p>
			Conference:
			{#if conferenceUrl}<a href={conferenceUrl} rel="noreferrer noopener">{conference}</a>{:else}{conference}{/if}
		</p>
	{/if}
	{#if description}<p>{description}</p>{/if}
	{#if attendees.length}
		<ul>
			{#each attendees as person}
				<li>{person.name || person.email}</li>
			{/each}
		</ul>
	{/if}
	{#if alert}<p class="alert" role="status">{alert}</p>{/if}
	{#if variant === 'recorded'}
		<p>{recorded}</p>
		<button type="button" onclick={onchange}>Change my response</button>
	{:else if variant !== 'cancel' && (summary || !alert)}
		<div role="radiogroup" aria-label="Response">
			{#each partStats as value}
				<button type="button" role="radio" aria-checked={selected === value} onclick={() => onselect(value)}>
					{labels[value]}
				</button>
			{/each}
		</div>
		{#if selected}
			<label>
				Note to the organizer (optional)
				<textarea bind:value={note} maxlength="512" rows="3"></textarea>
			</label>
			<button type="button" disabled={pending} onclick={onsend}>Send response</button>
		{/if}
	{/if}
</article>

<style>
	.card {
		display: grid;
		gap: var(--space-2);
		width: min(32rem, 100%);
		margin: var(--space-4) auto;
		padding: var(--space-4);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	.eyebrow {
		margin: 0;
		color: var(--color-brand);
		text-transform: capitalize;
	}
	h1,
	p {
		margin: 0;
	}
	.sub {
		color: var(--color-muted);
	}
	.alert {
		color: var(--color-danger);
	}
	button {
		font: inherit;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
	}
	button[aria-checked='true'],
	button[disabled] {
		background: var(--color-accent);
		color: var(--color-accent-fg);
	}
	textarea {
		width: 100%;
		font: inherit;
		background: var(--color-input);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
</style>
