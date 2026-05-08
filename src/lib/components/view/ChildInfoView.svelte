<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import { lookupLabel } from './labels';
	let { data }: { data: SubmissionRow } = $props();
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Child information</h2>
	<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
		<dt class="font-medium">Date of birth</dt>
		<dd>{data.dateOfBirth ?? '—'}</dd>
		<dt class="font-medium">Primary language</dt>
		<dd>{lookupLabel('primaryLanguage', data.primaryLanguage)}</dd>
		{#if data.submitterSurname}
			<dt class="font-medium">Surname</dt>
			<dd>{data.submitterSurname}</dd>
		{/if}
	</dl>
</section>
