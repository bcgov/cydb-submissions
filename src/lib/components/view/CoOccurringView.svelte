<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import { lookupLabel } from './labels';
	let { data }: { data: SubmissionRow } = $props();

	const conditions = $derived((data.conditions ?? []) as string[]);
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Co-occurring conditions</h2>
	{#if conditions.length === 0}
		<p class="text-sm text-gray-600">None reported.</p>
	{:else}
		<ul class="list-disc pl-5 text-sm">
			{#each conditions as cond}
				<li>{lookupLabel('conditions', cond)}</li>
			{/each}
		</ul>
	{/if}
</section>
