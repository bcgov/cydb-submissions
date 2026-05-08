<script lang="ts">
	import type { SubmissionAttachmentRow } from '$lib/types';

	let { attachments }: { attachments: SubmissionAttachmentRow[] } = $props();
</script>

<section>
	<h2 class="text-lg font-semibold mb-2">Attachments ({attachments.length})</h2>
	{#if attachments.length === 0}
		<p class="text-sm text-gray-600">No attachments.</p>
	{:else}
		<ul class="space-y-4">
			{#each attachments as a (a.id)}
				<li class="border rounded p-3">
					<div class="text-sm mb-2">
						<strong>{a.originalFilename}</strong>
						<span class="text-gray-600"> — {a.mimeType} • {(a.sizeBytes / 1024).toFixed(0)} KB</span>
						<a class="ml-3 text-blue-700 underline" href="/attachments/{a.id}?download=1">Download</a>
					</div>
					{#if a.mimeType === 'application/pdf'}
						<iframe src="/attachments/{a.id}" class="w-full h-[480px] border" title={a.originalFilename}></iframe>
					{:else if a.mimeType.startsWith('image/')}
						<img src="/attachments/{a.id}" alt={a.originalFilename} class="max-h-[480px] border" />
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</section>
