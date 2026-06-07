<script lang="ts">
	import type { PageData } from './$types';
	import SubmissionView from '$lib/components/view/SubmissionView.svelte';
	import AttachmentsView from '$lib/components/view/AttachmentsView.svelte';
	import MetadataView from '$lib/components/view/MetadataView.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto max-w-3xl space-y-8 p-6">
	<header class="flex items-center justify-between">
		<div>
			<a href="/submissions" class="text-sm text-blue-700 underline">← Back to submissions</a>
			<h1 class="mt-2 text-2xl font-semibold">Submission {data.submission.submissionUuid}</h1>
		</div>
		<StatusBadge status={data.submission.status as never} />
	</header>

	<SubmissionView data={data.submission} attachments={data.attachments} />
	<AttachmentsView attachments={data.attachments} />
	<MetadataView metadata={data.metadata} />
</div>
