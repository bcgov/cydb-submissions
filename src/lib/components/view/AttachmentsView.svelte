<script lang="ts">
	import type { AttachmentWithOcr } from '$lib/types';
	import { Badge } from '$lib/components/ui/badge';
	import { formatDate } from '$lib/format-date';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import FileIcon from '@lucide/svelte/icons/file';
	import * as Table from '$lib/components/ui/table';
	import TableRow from '../ui/table/table-row.svelte';

	let { attachments }: { attachments: AttachmentWithOcr[] } = $props();

	// Which pane each attachment shows: the document, extracted OCR text, or keyword matches.
	let pane = $state<Record<number, 'doc' | 'text' | 'keyword'>>({});

	type OcrStatus = AttachmentWithOcr['ocr']['status'];
	const OCR_META: Record<NonNullable<OcrStatus>, { label: string; class: string }> = {
		processed: { label: 'OCR · processed', class: 'border-green-200 bg-green-50 text-green-800' },
		queued: { label: 'OCR · queued', class: 'border-amber-200 bg-amber-50 text-amber-800' },
		processing: { label: 'OCR · processing', class: 'border-blue-200 bg-blue-50 text-blue-800' },
		failed: { label: 'OCR · failed', class: 'border-red-200 bg-red-50 text-red-800' },
		abandoned: { label: 'OCR · abandoned', class: 'border-red-200 bg-red-50 text-red-800' }
	};
	const notRun = { label: 'OCR · not run', class: 'border-gray-200 bg-gray-50 text-gray-600' };
	const ocrMeta = (s: OcrStatus) => (s ? OCR_META[s] : notRun);

	const fmtSize = (bytes: number) =>
		bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`;
</script>

<section>
	<h2 class="mb-3 text-xs font-medium tracking-wide text-gray-500 uppercase">
		Attachments ({attachments.length})
	</h2>

	{#if attachments.length === 0}
		<p class="text-sm text-gray-600">No attachments.</p>
	{:else}
		<ul class="space-y-4">
			{#each attachments as a (a.id)}
				{@const showText = pane[a.id] === 'text' && Boolean(a.ocr.text)}
				{@const showKeyword = pane[a.id] === 'keyword' && Boolean(a.ocr.text)}
				<li class="overflow-hidden rounded-lg border border-gray-200">
					<!-- Header: name, meta, OCR status, actions -->
					<div
						class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 px-4 py-3"
					>
						<FileIcon class="size-4 shrink-0 text-gray-400" />
						<span class="text-sm font-medium text-gray-900">{a.originalFilename}</span>
						<span class="text-xs text-gray-500">{a.mimeType} · {fmtSize(a.sizeBytes)}</span>
						<Badge variant="outline" class="text-xs {ocrMeta(a.ocr.status).class}">
							{ocrMeta(a.ocr.status).label}{a.ocr.pages ? ` · ${a.ocr.pages}p` : ''}
						</Badge>

						<div class="ml-auto flex items-center gap-1 text-sm">
							{#if a.ocr.text}
								<!-- Toggle the preview pane between the document and its extracted text -->
								<button
									type="button"
									class="rounded px-2 py-1 {!showText && !showKeyword
										? 'bg-gray-100 font-medium text-gray-900'
										: 'text-gray-500 hover:bg-gray-50'}"
									onclick={() => (pane[a.id] = 'doc')}
								>
									Document
								</button>
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded px-2 py-1 {showText
										? 'bg-gray-100 font-medium text-gray-900'
										: 'text-gray-500 hover:bg-gray-50'}"
									onclick={() => (pane[a.id] = 'text')}
								>
									<FileTextIcon class="size-3.5" />
									Extracted text
								</button>
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded px-2 py-1 {showKeyword
										? 'bg-gray-100 font-medium text-gray-900'
										: 'text-gray-500 hover:bg-gray-50'}"
									onclick={() => (pane[a.id] = 'keyword')}
								>
									<FileTextIcon class="size-3.5" />
									Matched terms
								</button>
							{/if}
							<a
								class="inline-flex items-center gap-1 rounded px-2 py-1 text-blue-700 hover:bg-blue-50"
								href="/attachments/{a.id}?download=1"
							>
								<DownloadIcon class="size-3.5" />
								Download
							</a>
						</div>
					</div>

					<!-- Preview pane -->
					<div class="bg-gray-50 p-4">
						{#if showText}
							<pre
								class="max-h-[480px] overflow-auto rounded border border-gray-200 bg-white p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-gray-800">{a
									.ocr.text}</pre>
							{#if a.ocr.processedAt}
								<p class="mt-2 text-xs text-gray-500">
									Extracted {a.ocr.pages ?? '?'} page{a.ocr.pages === 1 ? '' : 's'} · {formatDate(
										a.ocr.processedAt
									)}
								</p>
							{/if}
						{:else if showKeyword}
							<Table.Root>
								<Table.Header>
									<Table.Row>
										<Table.Cell>Category</Table.Cell>
										<Table.Cell>Matched Terms</Table.Cell>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each a.ocr.keyword.entries() as category}
									<Table.Row>
										<Table.Cell>{category[0]}</Table.Cell>
										<Table.Cell>{category[1].join('; ')}</Table.Cell>
									</Table.Row>
									{/each}
								</Table.Body>
							</Table.Root>
						{:else if a.mimeType === 'application/pdf'}
							<iframe
								src="/attachments/{a.id}"
								class="h-[480px] w-full rounded border border-gray-200 bg-white"
								title={a.originalFilename}
							></iframe>
						{:else if a.mimeType.startsWith('image/')}
							<img
								src="/attachments/{a.id}"
								alt={a.originalFilename}
								class="max-h-[480px] rounded border border-gray-200 bg-white"
							/>
						{:else}
							<p class="text-sm text-gray-500">No inline preview for this file type.</p>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
