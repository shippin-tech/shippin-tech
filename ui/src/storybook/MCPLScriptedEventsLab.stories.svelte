<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import MCPLScriptedEventsLab from './MCPLScriptedEventsLab.svelte';

	const { Story } = defineMeta({
		title: 'MCPL/Scripted Events Lab',
		component: MCPLScriptedEventsLab,
		tags: ['autodocs'],
		args: {
			sessionId: 'demo-mail-onboarding',
			term: 'DKIM',
			resource: 'workspace-mail'
		},
		parameters: {
			layout: 'padded'
		}
	});
</script>

<Story name="Mail onboarding signals" />
<Story name="Docs onboarding signals" args={{ sessionId: 'demo-docs', term: 'workspace', resource: 'workspace-docs' }} />
