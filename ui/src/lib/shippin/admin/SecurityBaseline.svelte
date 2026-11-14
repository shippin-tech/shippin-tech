<script lang="ts">
	import {
		baselineState,
		describeValue,
		pendingChanges,
		type Baseline,
		type BaselineRecords
	} from '$lib/portal/baseline';

	let {
		baselines,
		records,
		busy = '',
		notice = '',
		onapply
	}: {
		baselines: readonly Baseline[];
		records: BaselineRecords;
		busy?: string;
		notice?: string;
		onapply: (baseline: Baseline, on: boolean) => void;
	} = $props();

	function checked(baseline: Baseline): boolean {
		return baselineState(baseline, records) === 'on';
	}

	function stateLabel(baseline: Baseline): string {
		switch (baselineState(baseline, records)) {
			case 'on': return 'on';
			case 'off': return 'off';
			case 'mixed': return 'partly applied';
			case 'unavailable': return 'not available on this server';
			default: return 'not loaded';
		}
	}
</script>

<section class="baseline" aria-labelledby="baseline-title">
	<header>
		<h1 id="baseline-title">Security baseline</h1>
		<p>Each rule is one checkbox. Nothing is switched on for you. Every setting a rule changes is listed with the exact value it writes, so you can see what changes before you tick it.</p>
	</header>
	{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	<ul class="rules">
		{#each baselines as baseline (baseline.id)}
			{@const state = baselineState(baseline, records)}
			{@const isOn = state === 'on'}
			{@const changes = pendingChanges(baseline, records, !isOn)}
			<li class="rule" data-state={state}>
				<label class="head">
					<input
						type="checkbox"
						checked={isOn}
						indeterminate={state === 'mixed'}
						disabled={state === 'unavailable' || state === 'unknown' || busy !== ''}
						aria-describedby={`baseline-${baseline.id}-summary`}
						onchange={(event) => onapply(baseline, event.currentTarget.checked)}
					/>
					<span class="title">{baseline.title}</span>
					<small class="state">{busy === baseline.id ? 'saving…' : stateLabel(baseline)}</small>
				</label>
				<p id={`baseline-${baseline.id}-summary`} class="summary">{baseline.summary}</p>
				{#if baseline.unavailable}
					<p class="unavailable">{baseline.unavailable}</p>
				{:else}
					<details>
						<summary>What this changes ({baseline.settings.length} {baseline.settings.length === 1 ? 'setting' : 'settings'}{changes.length ? `, ${changes.length} would change now` : ''})</summary>
						<table>
							<thead>
								<tr><th scope="col">Setting</th><th scope="col">Now</th><th scope="col">When {isOn ? 'off' : 'on'}</th><th scope="col">Effect</th></tr>
							</thead>
							<tbody>
								{#each baseline.settings as setting (setting.object + '.' + setting.property)}
									{@const current = records[setting.object]?.[setting.property]}
									{@const target = isOn ? setting.off : setting.on}
									<tr class:changes={changes.includes(setting)}>
										<th scope="row"><span class="label">{setting.label}</span><code>{setting.object}.{setting.property}</code></th>
										<td>{records[setting.object] ? describeValue(current as never) : '—'}</td>
										<td>{describeValue(target)}</td>
										<td>{setting.effect}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.baseline { display: grid; gap: var(--space-4); max-inline-size: 72rem; }
	header p { color: var(--color-muted); max-inline-size: 60ch; }
	.notice { padding: var(--space-2) var(--space-3); border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-card); }
	.rules { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-3); }
	.rule { border: 1px solid var(--color-border); border-radius: var(--radius); padding: var(--space-3); background: var(--color-card); display: grid; gap: var(--space-2); }
	.rule[data-state='unavailable'] { opacity: 0.8; }
	.head { display: flex; align-items: center; gap: var(--space-2); cursor: pointer; }
	.head input { inline-size: 1.15rem; block-size: 1.15rem; accent-color: var(--brand-accent, #22d3ee); }
	.title { font-weight: 600; }
	.state { color: var(--color-muted); margin-inline-start: auto; }
	.summary { margin: 0; color: var(--color-muted); }
	.unavailable { margin: 0; padding: var(--space-2); border-inline-start: 3px solid var(--color-border); color: var(--color-muted); }
	details summary { cursor: pointer; }
	table { inline-size: 100%; border-collapse: collapse; margin-block-start: var(--space-2); font-size: 0.95em; }
	th, td { text-align: start; vertical-align: top; padding: var(--space-1) var(--space-2); border-block-start: 1px solid var(--color-border); }
	thead th { border-block-start: 0; color: var(--color-muted); font-weight: 600; }
	th[scope='row'] { display: grid; gap: 2px; }
	th[scope='row'] code { font-size: 0.8em; color: var(--color-muted); }
	tr.changes td:nth-child(3) { font-weight: 600; }
</style>
