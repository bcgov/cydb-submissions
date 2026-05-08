<script lang="ts">
	import type { SubmissionRow } from '$lib/types';
	import ChildInfoView from './ChildInfoView.svelte';
	import DevelopmentalHistoryView from './DevelopmentalHistoryView.svelte';
	import DiagnosisView from './DiagnosisView.svelte';
	import FunctionalImpactView from './FunctionalImpactView.svelte';
	import CoOccurringView from './CoOccurringView.svelte';
	import CurrentSupportsView from './CurrentSupportsView.svelte';
	import ConsentView from './ConsentView.svelte';

	let { data }: { data: SubmissionRow } = $props();
</script>

<div class="space-y-8">
	<ChildInfoView {data} />
	<DevelopmentalHistoryView {data} />
	<DiagnosisView {data} />
	<FunctionalImpactView {data} />
	<CoOccurringView {data} />
	<CurrentSupportsView {data} />
	<ConsentView {data} />
</div>
