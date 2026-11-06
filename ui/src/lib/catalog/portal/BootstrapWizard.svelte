<script lang="ts">
	import { Checkbox, Select } from 'bits-ui';
	import { bootstrap } from '$lib/portal/catalog';
	import Copy from './Copy.svelte';
	import {
		BACK,
		COMPLETE,
		CONFIGURED,
		CREDENTIALS,
		EMPTY_FORM,
		FAILED_COMPLETE,
		FAILED_LOAD,
		FINISH,
		INTRO,
		LOADING,
		NEXT,
		NEXT_STEP,
		NO_CONFIRM,
		REQUIRED,
		RESTART,
		WELCOME,
		stepLabel,
		type FinishResult
	} from '$lib/portal/bootstrap';

	let {
		values,
		onchange,
		onfinish,
		ready = true,
		loadError = ''
	}: {
		values: Record<string, string | boolean>;
		onchange: (name: string, value: string | boolean) => void;
		onfinish: () => Promise<FinishResult>;
		ready?: boolean;
		loadError?: string;
	} = $props();

	let step = $state(0);
	let phase = $state<'form' | 'complete'>('form');
	let saving = $state(false);
	let missing = $state(false);
	let problem = $state('');
	let credentials = $state<{ label: string; value: string }[]>([]);

	const steps = bootstrap.steps;
	const current = $derived(steps[step]);
	const formEmpty = (steps.length as number) === 0;

	function textValue(name: string): string {
		const value = values[name];
		return typeof value === 'string' ? value : '';
	}

	function incomplete(): boolean {
		if (!current) return true;
		return current.fields.some((field) => {
			if (field.kind === 'boolean') return false;
			const value = values[field.name];
			return typeof value !== 'string' || value.length === 0;
		});
	}

	function next() {
		if (incomplete()) {
			missing = true;
			return;
		}
		missing = false;
		problem = '';
		if (step < steps.length - 1) step += 1;
	}

	function back() {
		missing = false;
		problem = '';
		if (step > 0) step -= 1;
	}

	async function finish() {
		if (incomplete() || saving) {
			missing = incomplete();
			return;
		}
		missing = false;
		saving = true;
		problem = '';
		try {
			const result = await onfinish();
			if (result.status === 'saved') {
				credentials = result.credentials ?? [];
				phase = 'complete';
			} else if (result.status === 'rejected') problem = FAILED_COMPLETE;
			else problem = NO_CONFIRM;
		} catch {
			problem = FAILED_COMPLETE;
		} finally {
			saving = false;
		}
	}
</script>

<div class="wizard">
	{#if !ready}
		<p>{LOADING}</p>
	{:else if loadError}
		<p role="alert">{FAILED_LOAD}</p>
	{:else if formEmpty}
		<p>{EMPTY_FORM}</p>
	{:else if phase === 'complete'}
		<h1>{COMPLETE}</h1>
		<p>{CREDENTIALS}</p>
		{#each credentials as item (item.label)}
			<p class="credential">
				<span>{item.label}</span>
				<code>{item.value}</code>
				<Copy value={item.value} label={item.label} />
			</p>
		{/each}
		<p>{CONFIGURED}</p>
		<p><strong>{NEXT_STEP}</strong> {RESTART}</p>
	{:else if current}
		<h1>{WELCOME}</h1>
		<p>{INTRO}</p>
		<p>{bootstrap.description}</p>
		<p>{stepLabel(step + 1, steps.length)}</p>
		<section>
			<h2>{current.title}</h2>
			<div class="fields">
				{#each current.fields as field (field.name)}
					{#if field.kind === 'boolean'}
						<label class="check-row">
							<Checkbox.Root
								class="check"
								checked={values[field.name] === true}
								onCheckedChange={(checked) => onchange(field.name, checked === true)}
								aria-label={field.label}
							/>
							<span>{field.label}</span>
							<span>{values[field.name] === true ? 'On' : 'Off'}</span>
						</label>
					{:else if field.kind === 'choice'}
						<label class="stack">
							{field.label}
							<Select.Root
								type="single"
								value={textValue(field.name)}
								onValueChange={(nextValue) => {
									if (typeof nextValue === 'string') onchange(field.name, nextValue);
								}}
								items={field.options.map((option) => ({ value: option.value, label: option.label }))}
							>
								<Select.Trigger class="choice" aria-label={field.label}>
									<Select.Value placeholder={field.label} />
								</Select.Trigger>
								<Select.Portal>
									<Select.Content class="menu">
										{#each field.options as option (option.value)}
											<Select.Item class="option" value={option.value} label={option.label}>
												{option.label}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Portal>
							</Select.Root>
						</label>
					{:else}
						<label class="stack">
							{field.label}
							<input
								name={field.name}
								value={textValue(field.name)}
								oninput={(event) => onchange(field.name, event.currentTarget.value)}
							/>
						</label>
					{/if}
				{/each}
			</div>
		</section>
		{#if missing}<p role="alert">{REQUIRED}</p>{/if}
		{#if problem}<p role="alert">{problem}</p>{/if}
		<div class="actions">
			<button type="button" onclick={back} disabled={step === 0}>{BACK}</button>
			{#if step < steps.length - 1}
				<button type="button" onclick={next}>{NEXT}</button>
			{:else}
				<button type="button" onclick={finish} disabled={saving}>{FINISH}</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.wizard {
		display: grid;
		gap: var(--y-s);
		padding: var(--y-s) var(--x-s);
		background: var(--color-card);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}
	h1, h2, p { margin: 0; }
	.fields {
		display: grid;
		gap: var(--y-2xs);
	}
	.stack, .check-row { display: grid; gap: var(--y-3xs); }
	.check-row {
		grid-template-columns: auto 1fr auto;
		align-items: center;
	}
	input, .wizard :global(.choice) {
		font: inherit;
		min-height: 2.75rem;
		padding: var(--y-2xs) var(--x-2xs);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-input);
		color: var(--color-text);
	}
	.wizard :global(.choice) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		inline-size: 100%;
		text-align: start;
		cursor: pointer;
	}
	.wizard :global(.check) {
		inline-size: 1.25rem;
		block-size: 1.25rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-input);
		color: var(--color-accent-fg);
	}
	.wizard :global(.check[data-state='checked']) {
		background: var(--color-brand);
	}
	.wizard :global(.check[data-state='checked'])::after {
		content: '✓';
	}
	:global(.menu) {
		z-index: 20;
		max-block-size: 16rem;
		overflow: auto;
		background: var(--color-card);
		color: var(--color-text);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: var(--y-3xs);
	}
	:global(.option) {
		min-height: 2.75rem;
		display: flex;
		align-items: center;
		padding: 0 var(--x-2xs);
		border-radius: var(--radius);
		cursor: pointer;
	}
	:global(.option[data-highlighted]) {
		background: var(--color-accent);
		color: var(--color-accent-fg);
	}
	.actions { display: flex; gap: var(--x-2xs); }
	button {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 var(--x-s);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-card);
		color: var(--color-text);
		cursor: pointer;
	}
	button:disabled { cursor: not-allowed; opacity: 0.6; }
	.credential { display: flex; flex-wrap: wrap; align-items: center; gap: var(--x-2xs); }
	code { font-family: var(--font-mono); }
	p[role='alert'] { color: var(--color-danger); }
	input:focus-visible,
	button:focus-visible,
	.wizard :global(.choice:focus-visible),
	.wizard :global(.check:focus-visible),
	:global(.option:focus-visible) {
		outline: 2px solid var(--color-focus);
		outline-offset: 2px;
	}
	@media (prefers-reduced-motion: reduce) {
		button, .wizard :global(.choice), .wizard :global(.check) { transition: none; }
	}
</style>
