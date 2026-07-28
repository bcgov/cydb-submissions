<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { formatDate } from '$lib/format-date';
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let note = $state('');

	// Whether the reingest confirmation dialog is open
	let reingestDialogOpen = $state(false);

	const backHref = $derived(
		(() => {
			const from = page.url.searchParams.get('from');
			return from ? `/submissions${decodeURIComponent(from)}` : '/submissions';
		})()
	);
</script>

<div class="mx-auto max-w-3xl space-y-8 p-6">
	<header class="flex items-center justify-between">
		<div>
			<a href={backHref} class="text-sm text-blue-700 underline">← Back to submissions</a>
			<h1 class="mt-2 text-2xl font-semibold">Invalid Submission</h1>
			<p class="mt-1 text-sm text-gray-500">{data.submission.uuid}</p>
		</div>
		<div class="flex items-center gap-2">
			<StatusBadge status={'invalid' as never} />
			{#if data.chefsLink}
				<DropdownMenu>
					<DropdownMenuTrigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon" aria-label="More options">
								<EllipsisVerticalIcon />
							</Button>
						{/snippet}
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem>
							{#snippet child({ props })}
								<a {...props} href={data.chefsLink} target="_blank" rel="noreferrer noopener">
									See this submission in CHEFS
								</a>
							{/snippet}
						</DropdownMenuItem>
						{#if data.canReingest}
							<DropdownMenuItem variant="destructive" onclick={() => (reingestDialogOpen = true)}>
								Reingest submission
							</DropdownMenuItem>
						{/if}
					</DropdownMenuContent>
				</DropdownMenu>
			{/if}
		</div>
	</header>

	{#if form?.action === 'reingest' && form?.error}
		<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
			{form.error}
		</p>
	{/if}

	<AlertDialog.Root
		open={reingestDialogOpen}
		onOpenChange={(open) => { if (!open) reingestDialogOpen = false; }}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Reingest this submission?</AlertDialog.Title>
				<AlertDialog.Description>
					This will permanently delete this invalid-submission record and re-fetch and re-process
					it fresh from CHEFS. This cannot be undone.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel onclick={() => (reingestDialogOpen = false)}>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/reingest"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							reingestDialogOpen = false;
						}}
				>
					<AlertDialog.Action type="submit">Reingest</AlertDialog.Action>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

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

	<section class="space-y-3 rounded border border-gray-200 px-5 py-4">
		<h2 class="text-base font-semibold">Resolution</h2>
		{#if data.submission.resolvedAt}
			<p class="text-sm text-gray-700">
				Marked as resolved by <span class="font-medium">{data.submission.resolvedBy}</span>
				on {formatDate(data.submission.resolvedAt)}.
			</p>
			{#if data.submission.resolvedNote}
				<p class="text-sm text-gray-700"><span class="font-medium">Note:</span> {data.submission.resolvedNote}</p>
			{/if}
		{:else}
			<p class="text-sm text-gray-500">This submission has not been resolved.</p>
			<form method="POST" action="?/resolve" class="space-y-3">
				<div class="space-y-1">
					<label for="note" class="block text-sm font-medium text-gray-700">Resolution note <span class="text-red-600">*</span></label>
					<textarea
						id="note"
						name="note"
						bind:value={note}
						required
						rows="3"
						class="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none"
						placeholder="Describe why this submission is being marked as resolved..."
					></textarea>
					{#if form?.action === 'resolve' && form?.error}
						<p class="text-sm text-red-600">{form.error}</p>
					{/if}
				</div>
				<button
					type="submit"
					disabled={!note.trim()}
					class="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Mark as Resolved
				</button>
			</form>
		{/if}
	</section>
</div>
