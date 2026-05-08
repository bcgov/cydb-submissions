<script lang="ts">
	import * as Accordion from '$lib/components/ui/accordion';
	import type { SubmissionMetadataRow } from '$lib/types';

	let { metadata }: { metadata: SubmissionMetadataRow | null } = $props();
</script>

<Accordion.Root type="single">
	<Accordion.Item value="meta">
		<Accordion.Trigger>Submission metadata</Accordion.Trigger>
		<Accordion.Content>
			{#if !metadata}
				<p class="text-sm text-gray-600">No metadata recorded.</p>
			{:else}
				<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
					<dt class="font-medium">Submitted at</dt>
					<dd>{metadata.submissionTimestamp}</dd>
					<dt class="font-medium">IP address</dt>
					<dd>{metadata.ipAddress ?? '—'}</dd>
					<dt class="font-medium">User agent</dt>
					<dd>{metadata.userAgent ?? '—'}</dd>
					<dt class="font-medium">Accept-Language</dt>
					<dd>{metadata.acceptLanguage ?? '—'}</dd>
					<dt class="font-medium">Browser fingerprint</dt>
					<dd class="font-mono text-xs">{metadata.browserFingerprint ?? '—'}</dd>
				</dl>
			{/if}
		</Accordion.Content>
	</Accordion.Item>
</Accordion.Root>
