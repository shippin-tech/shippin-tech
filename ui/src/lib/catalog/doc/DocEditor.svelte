<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import { safeLink } from '$lib/adapter/docs-call';

	type Props = {
		content: string;
		editable: boolean;
		onchange: (html: string) => void;
	};

	let { content, editable, onchange }: Props = $props();

	let host = $state<HTMLDivElement | null>(null);
	let editor = $state<Editor | null>(null);
	let tick = $state(0);
	let linkOpen = $state(false);
	let linkText = $state('');
	let linkError = $state('');

	onMount(async () => {
		const [{ Editor: EditorClass }, { default: StarterKit }, { default: TextAlign }] = await Promise.all([
			import('@tiptap/core'),
			import('@tiptap/starter-kit'),
			import('@tiptap/extension-text-align')
		]);
		if (!host) return;
		editor = new EditorClass({
			element: host,
			editable,
			content,
			extensions: [
				StarterKit.configure({
					heading: { levels: [1, 2, 3] },
					link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }
				}),
				TextAlign.configure({ types: ['heading', 'paragraph'] })
			],
			editorProps: {
				attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Document text', class: 'doc-body' }
			},
			onUpdate: ({ editor: current }) => onchange(current.getHTML()),
			onTransaction: () => (tick += 1)
		});
	});

	onDestroy(() => editor?.destroy());

	type Chain = ReturnType<Editor['chain']>;

	function run(command: (chain: Chain) => Chain) {
		if (editor) command(editor.chain().focus()).run();
	}

	function active(name: string, attributes?: Record<string, unknown>): boolean {
		void tick;
		return editor?.isActive(name, attributes) ?? false;
	}

	function aligned(side: string): boolean {
		void tick;
		return editor?.isActive({ textAlign: side }) ?? false;
	}

	function openLink() {
		linkText = (editor?.getAttributes('link').href as string | undefined) ?? '';
		linkError = '';
		linkOpen = true;
	}

	function applyLink(event: SubmitEvent) {
		event.preventDefault();
		if (!linkText.trim()) {
			run((chain) => chain.extendMarkRange('link').unsetLink());
			linkOpen = false;
			return;
		}
		const href = safeLink(linkText);
		if (!href) {
			linkError = 'Enter a web or email address.';
			return;
		}
		run((chain) => chain.extendMarkRange('link').setLink({ href }));
		linkOpen = false;
	}

	/** The editor's current content, for an export taken before the next autosave. */
	export function currentHtml(): string {
		return editor?.getHTML() ?? content;
	}

	const formats = [
		{ label: 'Bold', mark: 'B', name: 'bold', apply: (chain: Chain) => chain.toggleBold() },
		{ label: 'Italic', mark: 'I', name: 'italic', apply: (chain: Chain) => chain.toggleItalic() },
		{ label: 'Underline', mark: 'U', name: 'underline', apply: (chain: Chain) => chain.toggleUnderline() },
		{ label: 'Strikethrough', mark: 'S', name: 'strike', apply: (chain: Chain) => chain.toggleStrike() }
	];
	const headings = [1, 2, 3] as const;
	const blocks = [
		{ label: 'Bulleted list', mark: '•', name: 'bulletList', apply: (chain: Chain) => chain.toggleBulletList() },
		{ label: 'Numbered list', mark: '1.', name: 'orderedList', apply: (chain: Chain) => chain.toggleOrderedList() },
		{ label: 'Quote', mark: '“', name: 'blockquote', apply: (chain: Chain) => chain.toggleBlockquote() },
		{ label: 'Code block', mark: '<>', name: 'codeBlock', apply: (chain: Chain) => chain.toggleCodeBlock() }
	];
	const sides = [
		{ label: 'Align left', mark: 'L', side: 'left' },
		{ label: 'Align center', mark: 'C', side: 'center' },
		{ label: 'Align right', mark: 'R', side: 'right' }
	];
</script>

{#if editable}
	<!-- Pressing a button must not take focus from the text, or the pending format is lost. -->
	<div class="toolbar" role="toolbar" tabindex="-1" aria-label="Formatting" onmousedown={(event) => event.preventDefault()}>
		{#each formats as item (item.name)}
			<button type="button" aria-label={item.label} title={item.label} aria-pressed={active(item.name)} onclick={() => run(item.apply)}>{item.mark}</button>
		{/each}
		<span class="gap"></span>
		{#each headings as level (level)}
			<button
				type="button"
				aria-label="Heading {level}"
				title="Heading {level}"
				aria-pressed={active('heading', { level })}
				onclick={() => run((chain) => chain.toggleHeading({ level }))}>H{level}</button
			>
		{/each}
		<span class="gap"></span>
		{#each blocks as item (item.name)}
			<button type="button" aria-label={item.label} title={item.label} aria-pressed={active(item.name)} onclick={() => run(item.apply)}>{item.mark}</button>
		{/each}
		<span class="gap"></span>
		{#each sides as item (item.side)}
			<button
				type="button"
				aria-label={item.label}
				title={item.label}
				aria-pressed={aligned(item.side)}
				onclick={() => run((chain) => chain.setTextAlign(item.side))}>{item.mark}</button
			>
		{/each}
		<span class="gap"></span>
		<button type="button" aria-label="Link" title="Link" aria-pressed={active('link')} onclick={openLink}>Link</button>
		<button type="button" aria-label="Undo" title="Undo" onclick={() => run((chain) => chain.undo())}>Undo</button>
		<button type="button" aria-label="Redo" title="Redo" onclick={() => run((chain) => chain.redo())}>Redo</button>
	</div>
	{#if linkOpen}
		<form class="link-form" onsubmit={applyLink}>
			<label>
				<span>Link address</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={linkText} placeholder="example.com" autofocus />
			</label>
			<button type="submit">Apply link</button>
			<button type="button" onclick={() => (linkOpen = false)}>Cancel</button>
			{#if linkError}<p role="alert">{linkError}</p>{/if}
		</form>
	{/if}
{/if}

<div class="sheet" bind:this={host}></div>

<style>
	.toolbar { display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; position: sticky; top: 0; z-index: 2; padding: 0.25rem 0; background: var(--color-card); }
	.gap { width: 0.5rem; }
	button, input {
		font: inherit;
		min-height: 2.75rem;
		min-width: 2.75rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: var(--color-text);
		cursor: pointer;
	}
	input { cursor: text; }
	button[aria-pressed='true'] { background: var(--color-accent); color: var(--color-accent-fg); border-color: transparent; }
	.link-form { display: flex; flex-wrap: wrap; align-items: end; gap: 0.5rem; }
	.link-form label { display: grid; gap: 0.25rem; }
	.link-form span { font-size: 0.875rem; color: var(--color-muted); }
	.link-form p { margin: 0; font-weight: 600; }
	.sheet { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius); padding: clamp(1rem, 4vw, 3rem); min-height: 28rem; }
	.sheet :global(.doc-body) { outline: none; min-height: 24rem; max-width: 46rem; margin-inline: auto; line-height: 1.6; overflow-wrap: anywhere; }
	.sheet :global(.doc-body:focus-visible) { box-shadow: 0 0 0 2px var(--color-accent); border-radius: 2px; }
	.sheet :global(blockquote) { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid var(--color-border); color: var(--color-muted); }
	.sheet :global(pre) { padding: 0.75rem; border-radius: var(--radius); background: var(--color-card); overflow-x: auto; }
	.sheet :global(a) { color: inherit; text-decoration: underline; }
</style>
