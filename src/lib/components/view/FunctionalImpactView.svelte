<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import { lookupLabel } from './labels';
	let { data }: { data: SubmissionRow } = $props();
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Functional impact</h2>
	<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
		<dt class="font-medium">Communication</dt>
		<dd>{lookupLabel('communication', data.communication)}</dd>
		<dt class="font-medium">Social interaction</dt>
		<dd>{lookupLabel('socialInteraction', data.socialInteraction)}</dd>
		<dt class="font-medium">Daily living skills</dt>
		<dd>{lookupLabel('dailyLivingSkills', data.dailyLivingSkills)}</dd>
		<dt class="font-medium">Behavioural concerns</dt>
		<dd>{lookupLabel('behaviouralConcerns', data.behaviouralConcerns)}</dd>
	</dl>
</section>
