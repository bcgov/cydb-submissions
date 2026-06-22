<script lang="ts">
	import type { PageData } from './$types';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { formatDate } from '$lib/format-date';

	let { data }: { data: PageData } = $props();
</script>

<div class="mx-auto max-w-3xl space-y-8 p-6">
	<header class="flex items-center justify-between">
		<div>
			<a href="/submissions" class="text-sm text-blue-700 underline">← Back to submissions</a>
			<h1 class="mt-2 text-2xl font-semibold">Invalid Submission</h1>
			<p class="mt-1 text-sm text-gray-500">{data.submission.uuid}</p>
		</div>
		<StatusBadge status={'invalid' as never} />
	</header>

	<section class="space-y-3 rounded border border-gray-200 bg-gray-50 px-5 py-4">
		<h2 class="text-base font-semibold">Details</h2>
		<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
			<dt class="font-medium text-gray-600">Received</dt>
			<dd>{formatDate(data.submission.receivedAt)}</dd>

			<dt class="font-medium text-gray-600">IP Address</dt>
			<dd>{data.submission.ipAddress ?? '—'}</dd>

			<dt class="font-medium text-gray-600">User Agent</dt>
			<dd class="break-all">{data.submission.userAgent ?? '—'}</dd>
		</dl>
	</section>

	<section class="space-y-3 rounded border border-red-200 bg-red-50 px-5 py-4">
		<h2 class="text-base font-semibold text-red-800">Validation Errors</h2>
		{#if Array.isArray(data.submission.validationErrors) && data.submission.validationErrors.length > 0}
			<ul class="ml-4 list-disc space-y-1 text-sm text-red-700">
				{#each data.submission.validationErrors as err}
					<li>
						{#if typeof err === 'string'}
							{err}
						{:else if typeof err === 'object' && err !== null}
							<pre class="inline whitespace-pre-wrap font-mono text-xs">{JSON.stringify(err, null, 2)}</pre>
						{:else}
							{String(err)}
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<pre class="whitespace-pre-wrap rounded bg-white p-3 font-mono text-xs text-red-700">{JSON.stringify(data.submission.validationErrors, null, 2)}</pre>
		{/if}
	</section>

	<section class="space-y-3 rounded border border-gray-200 px-5 py-4">
		<h2 class="text-base font-semibold">Raw Payload</h2>
		<pre class="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-gray-100 p-3 font-mono text-xs">{JSON.stringify(data.submission.rawPayload, null, 2)}</pre>
	</section>
</div>
