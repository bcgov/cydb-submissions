<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import { lookupLabel, yesNo } from './labels';
	let { data }: { data: SubmissionRow } = $props();
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Developmental history</h2>
	<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
		<dt class="font-medium">Developmental concerns</dt>
		<dd>{yesNo(data.developmentalConcerns)}</dd>
		{#if data.developmentalConcerns}
			<dt class="font-medium">Age of first concern</dt>
			<dd>{lookupLabel('ageOfFirstConcern', data.ageOfFirstConcern)}</dd>
		{/if}
	</dl>
</section>
