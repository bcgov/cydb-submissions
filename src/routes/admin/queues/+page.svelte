<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Table from '$lib/components/ui/table';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let ocrResumeOpen = $state(false);
	let ocrRequeueAllOpen = $state(false);
	let chefsResumeOpen = $state(false);

	const ocrFailedCount = $derived(
		data.ocr.counts.find((c) => c.status === 'failed')?.n ?? 0
	);
	const ocrQueuedCount = $derived(
		data.ocr.counts.find((c) => c.status === 'queued')?.n ?? 0
	);
	const ocrProcessingCount = $derived(
		data.ocr.counts.find((c) => c.status === 'processing')?.n ?? 0
	);

	function fmtTime(s: string | null | undefined): string {
		if (!s) return '—';
		try {
			return new Date(s).toLocaleString();
		} catch {
			return s;
		}
	}
</script>

<div class="p-6 max-w-6xl mx-auto space-y-6">
	<div class="flex items-baseline justify-between">
		<div>
			<h1 class="text-2xl font-semibold">Queue pipeline</h1>
			<p class="text-sm text-gray-700">CHEFS ingestion + OCR processing — status, recent errors, and controls.</p>
		</div>
		<div class="text-xs text-gray-500 space-x-3">
			<a href="/admin/chefs" class="underline">CHEFS settings →</a>
			<a href="/admin/ocr" class="underline">OCR queue detail →</a>
		</div>
	</div>

	{#if form?.success}
		<p role="status" class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
			{form.success}
		</p>
	{/if}
	{#if form?.error}
		<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
			{form.error}
		</p>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
		<!-- CHEFS card -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-center justify-between">
					<Card.Title>CHEFS ingestion</Card.Title>
					{#if data.chefs.halted}
						<Badge variant="destructive">Halted</Badge>
					{:else if data.chefs.config.pollerEnabled}
						<Badge>Poller on</Badge>
					{:else}
						<Badge variant="outline">Poller off</Badge>
					{/if}
				</div>
				<Card.Description>
					Form: <code>{data.chefs.config.formId || '(unset)'}</code>
					<span class="text-xs text-gray-500"
						>· token via {data.chefs.config.apiTokenSource}{data.chefs.config.envOverrides.length > 0
							? ' · env overrides: ' + data.chefs.config.envOverrides.join(', ')
							: ''}</span
					>
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 text-sm">
				{#if data.chefs.halted}
					<div class="rounded border-l-4 border-red-500 bg-red-50 p-3">
						<div class="font-semibold text-red-900">
							Halted at {fmtTime(data.chefs.halted.trippedAt)}
						</div>
						<div class="text-xs mt-1">
							Last error: <code>{data.chefs.halted.lastErrorClass ?? 'unknown'}</code> ·
							threshold {data.chefs.halted.threshold}
						</div>
					</div>
				{/if}

				<div class="grid grid-cols-2 gap-2">
					<div class="rounded border p-2">
						<div class="text-xs text-gray-500">Last sync</div>
						<div class="font-medium">{fmtTime(data.chefs.lastSync?.finishedAt)}</div>
					</div>
					<div class="rounded border p-2">
						<div class="text-xs text-gray-500">Failure streak</div>
						<div class="font-medium">{data.chefs.failureCount}</div>
					</div>
					<div class="rounded border p-2">
						<div class="text-xs text-gray-500">Ingested (last)</div>
						<div class="font-medium">{data.chefs.lastSync?.ingested ?? '—'}</div>
					</div>
					<div class="rounded border p-2">
						<div class="text-xs text-gray-500">Invalid (last)</div>
						<div class="font-medium">{data.chefs.lastSync?.invalid ?? '—'}</div>
					</div>
				</div>

				{#if data.chefs.lastSync && data.chefs.lastSync.errors.length > 0}
					<div>
						<div class="text-xs text-gray-500 mb-1">Recent sync errors</div>
						<ul class="text-xs space-y-1 max-h-32 overflow-y-auto">
							{#each data.chefs.lastSync.errors as e, i (i)}
								<li class="rounded bg-red-50 px-2 py-1">
									{#if e.submissionUuid}<code>{e.submissionUuid}</code> —{/if}
									{e.message}
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</Card.Content>
			<Card.Footer class="gap-2 flex-wrap">
				<form method="POST" action="?/chefsSyncNow" use:enhance class="inline">
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<Button type="submit" size="sm">Sync now</Button>
				</form>
				{#if data.chefs.halted}
					<Button size="sm" variant="outline" onclick={() => (chefsResumeOpen = true)}>Resume</Button>
				{/if}
			</Card.Footer>
		</Card.Root>

		<!-- OCR card -->
		<Card.Root>
			<Card.Header>
				<div class="flex items-center justify-between">
					<Card.Title>OCR queue</Card.Title>
					{#if data.ocr.halted}
						<Badge variant="destructive">Halted</Badge>
					{:else if data.ocr.workerEnabled}
						<Badge>Worker on</Badge>
					{:else}
						<Badge variant="outline">Worker off</Badge>
					{/if}
				</div>
				<Card.Description>
					Provider: <code>{data.ocr.provider}</code>
				</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 text-sm">
				{#if data.ocr.halted}
					<div class="rounded border-l-4 border-red-500 bg-red-50 p-3">
						<div class="font-semibold text-red-900">
							Halted at {fmtTime(data.ocr.halted.trippedAt)}
						</div>
						<div class="text-xs mt-1">
							Last error: <code>{data.ocr.halted.lastErrorClass ?? 'unknown'}</code> ·
							threshold {data.ocr.halted.threshold} ·
							failing job IDs: {data.ocr.halted.jobIds.join(', ') || 'none recorded'}
						</div>
					</div>
				{/if}

				<div class="grid grid-cols-3 gap-2">
					<div class="rounded border p-2">
						<div class="text-xs text-gray-500">Queued</div>
						<div class="font-medium">{ocrQueuedCount}</div>
					</div>
					<div class="rounded border p-2">
						<div class="text-xs text-gray-500">Processing</div>
						<div class="font-medium">{ocrProcessingCount}</div>
					</div>
					<div class="rounded border p-2">
						<div class="text-xs text-gray-500">Failed</div>
						<div class="font-medium">{ocrFailedCount}</div>
					</div>
				</div>

				<div class="flex flex-wrap gap-1">
					{#each data.ocr.counts as c (c.status)}
						<Badge variant="outline">{c.status}: {c.n}</Badge>
					{/each}
					{#if data.ocr.counts.length === 0}
						<span class="text-xs text-gray-500">No jobs yet.</span>
					{/if}
				</div>
			</Card.Content>
			<Card.Footer class="gap-2 flex-wrap">
				{#if data.ocr.halted}
					<Button size="sm" onclick={() => (ocrResumeOpen = true)}>Resume queue</Button>
				{/if}
				{#if ocrFailedCount > 0}
					<Button size="sm" variant="outline" onclick={() => (ocrRequeueAllOpen = true)}>
						Requeue all failed ({ocrFailedCount})
					</Button>
				{/if}
			</Card.Footer>
		</Card.Root>
	</div>

	<!-- Recent failed jobs -->
	<section class="space-y-2">
		<h2 class="text-lg font-semibold">Recent OCR failures</h2>
		{#if data.ocr.recentFailed.length === 0}
			<p class="text-sm text-gray-500">No failed or abandoned jobs.</p>
		{:else}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Job</Table.Head>
						<Table.Head>Attachment</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head>Attempts</Table.Head>
						<Table.Head>Requeues</Table.Head>
						<Table.Head>Last error</Table.Head>
						<Table.Head>Updated</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.ocr.recentFailed as j (j.id)}
						<Table.Row>
							<Table.Cell>{j.id}</Table.Cell>
							<Table.Cell>{j.attachmentId}</Table.Cell>
							<Table.Cell><Badge variant="outline">{j.status}</Badge></Table.Cell>
							<Table.Cell>{j.attempts}</Table.Cell>
							<Table.Cell>{j.requeueCount}</Table.Cell>
							<Table.Cell><code class="text-xs">{j.lastError ?? ''}</code></Table.Cell>
							<Table.Cell class="text-xs">{fmtTime(j.updatedAt)}</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
			<p class="text-xs text-gray-500">
				Per-job requeue/abandon controls live on the
				<a href="/admin/ocr" class="underline">OCR queue detail page</a>.
			</p>
		{/if}
	</section>

	<!-- OCR resume confirmation -->
	<AlertDialog.Root bind:open={ocrResumeOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Resume the OCR queue?</AlertDialog.Title>
				<AlertDialog.Description>
					Clears the halt sentinel and resets the consecutive-failure counter. Failed jobs stay in
					their current state — use "Requeue all failed" if they should be retried.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/ocrResume"
					use:enhance={() => async ({ update }) => {
						await update();
						ocrResumeOpen = false;
					}}
				>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<AlertDialog.Action type="submit">Resume queue</AlertDialog.Action>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<!-- OCR requeue-all confirmation -->
	<AlertDialog.Root bind:open={ocrRequeueAllOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Requeue all failed OCR jobs?</AlertDialog.Title>
				<AlertDialog.Description>
					Resets all jobs in <code>failed</code> status back to <code>queued</code>, bumping their
					requeue counter. Abandoned jobs are not touched.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/ocrRequeueAllFailed"
					use:enhance={() => async ({ update }) => {
						await update();
						ocrRequeueAllOpen = false;
					}}
				>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<AlertDialog.Action type="submit">Requeue all</AlertDialog.Action>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<!-- CHEFS resume confirmation -->
	<AlertDialog.Root bind:open={chefsResumeOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Resume the CHEFS poller?</AlertDialog.Title>
				<AlertDialog.Description>
					Clears the halt sentinel and resets the failure streak. The poller resumes its normal
					cadence on the next tick.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/chefsResume"
					use:enhance={() => async ({ update }) => {
						await update();
						chefsResumeOpen = false;
					}}
				>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<AlertDialog.Action type="submit">Resume poller</AlertDialog.Action>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
