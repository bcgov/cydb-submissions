<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import { yesNo } from './labels';
	let { data }: { data: SubmissionRow } = $props();
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Consent</h2>
	<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
		<dt class="font-medium">Information accurate</dt>
		<dd>{yesNo(data.informationAccurate)}</dd>
		<dt class="font-medium">Data sharing consent</dt>
		<dd>{yesNo(data.dataSharingConsent)}</dd>
	</dl>
</section>
