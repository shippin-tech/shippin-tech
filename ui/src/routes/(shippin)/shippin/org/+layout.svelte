<script lang="ts">
	import OrgShell from '$lib/shippin/org/OrgShell.svelte';

	let { children } = $props();
</script>

<OrgShell>{@render children()}</OrgShell>
