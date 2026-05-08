<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import { lookupLabel } from './labels';
	let { data }: { data: SubmissionRow } = $props();

	const services = $derived((data.services ?? []) as string[]);
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Current supports</h2>
	<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
		<dt class="font-medium">Services</dt>
		<dd>
			{#if services.length === 0}
				—
			{:else}
				<ul class="list-disc pl-5">
					{#each services as svc}
						<li>{lookupLabel('services', svc)}</li>
					{/each}
				</ul>
			{/if}
		</dd>
		<dt class="font-medium">Weekly hours</dt>
		<dd>{data.weeklyHours ?? '—'}</dd>
	</dl>
</section>
