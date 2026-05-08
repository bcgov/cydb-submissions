<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import { lookupLabel, yesNo } from './labels';
	let { data }: { data: SubmissionRow } = $props();

	const tools = $derived((data.assessmentTools ?? []) as string[]);
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Diagnosis</h2>
	<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
		<dt class="font-medium">Has formal diagnosis</dt>
		<dd>{yesNo(data.hasFormalDiagnosis)}</dd>
		<dt class="font-medium">Diagnostic status</dt>
		<dd>{lookupLabel('diagnosticStatus', data.diagnosticStatus)}</dd>
		<dt class="font-medium">Assessment tools</dt>
		<dd>
			{#if tools.length === 0}
				—
			{:else}
				<ul class="list-disc pl-5">
					{#each tools as tool}
						<li>{lookupLabel('assessmentTools', tool)}</li>
					{/each}
				</ul>
			{/if}
		</dd>
	</dl>
</section>
