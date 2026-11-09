<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import WorkspaceDeployPanel from '$lib/catalog/platform/WorkspaceDeployPanel.svelte';

	const { Story } = defineMeta({
		title: 'Platform/Workspace Deploy Panel',
		component: WorkspaceDeployPanel,
		tags: ['autodocs'],
		args: {
			blueprint: 'mail',
			resource: 'workspace-mail',
			title: 'Queue mail deployment'
		}
	});
</script>

<Story name="Mail deployment feed" />
<Story name="Docs deployment feed" args={{ blueprint: 'docs', resource: 'workspace-docs', title: 'Queue docs deployment' }} />
