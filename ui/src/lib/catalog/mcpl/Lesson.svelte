<script lang="ts">
	import { complete, nextStep, type Lesson, type Progress } from '$lib/mcpl/lessons';

	type Props = { lesson: Lesson; progress: Progress; ondismiss: () => void };
	let { lesson, progress, ondismiss }: Props = $props();

	const current = $derived(nextStep(lesson, progress));
	const finished = $derived(complete(lesson, progress));
	const count = $derived(lesson.steps.filter((step) => progress.done.includes(step.id)).length);
</script>

{#if !progress.dismissed}
	<aside class="lesson" aria-labelledby="lesson-{lesson.id}">
		<header>
			<h2 id="lesson-{lesson.id}">{lesson.title}</h2>
			<span class="count">{count} of {lesson.steps.length} done</span>
			<button type="button" class="link" onclick={ondismiss}>{finished ? 'Close' : 'Hide'}</button>
		</header>
		{#if finished}
			<p role="status">All done.</p>
		{/if}
		<ol>
			{#each lesson.steps as step (step.id)}
				{@const done = progress.done.includes(step.id)}
				<li data-state={done ? 'done' : step.id === current?.id ? 'current' : 'todo'} aria-current={step.id === current?.id ? 'step' : undefined}>
					<span class="mark" aria-hidden="true">{done ? '✓' : ''}</span>
					<span class="say">{step.say}</span>
					{#if step.id === current?.id && step.where}
						<a href={step.where}>Go there</a>
					{/if}
					<span class="sr-only">{done ? '(done)' : ''}</span>
				</li>
			{/each}
		</ol>
	</aside>
{/if}

<style>
	.lesson { display: grid; gap: var(--space-2); padding: var(--space-3); border: 1px solid var(--color-border); border-inline-start: 3px solid var(--color-accent); border-radius: var(--radius); background: var(--color-card); }
	header { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); }
	h2 { margin: 0; font-size: 1.1em; }
	.count { color: var(--color-muted); }
	header .link { margin-inline-start: auto; }
	p { margin: 0; }
	ol { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-1); }
	li { display: flex; align-items: baseline; gap: var(--space-2); }
	li[data-state='done'] .say { color: var(--color-muted); text-decoration: line-through; }
	li[data-state='current'] .say { font-weight: 600; }
	.mark { inline-size: 1.2rem; block-size: 1.2rem; flex: none; display: inline-grid; place-items: center; border: 1px solid var(--color-border); border-radius: 50%; font-size: 0.8em; }
	li[data-state='done'] .mark { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	button.link { font: inherit; background: transparent; border: 0; color: var(--color-text); text-decoration: underline; cursor: pointer; padding: 0; min-height: auto; }
	.sr-only { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
