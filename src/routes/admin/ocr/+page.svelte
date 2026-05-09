<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Table from '$lib/components/ui/table';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	let resumeOpen = $state(false);
</script>

<div class="p-6 max-w-5xl mx-auto space-y-8">
	<div>
		<h1 class="text-2xl font-semibold mb-2">OCR Queue</h1>
		<p class="text-gray-700">Phase 3 admin tooling: monitor and operate the document-reading queue.</p>
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

	{#if data.halted}
		<section class="rounded border-l-4 border-red-500 bg-red-50 p-4">
			<div class="font-semibold text-red-900">Queue halted at {data.halted.trippedAt}</div>
			<div class="text-sm mt-1">Last error class: <code>{data.halted.lastErrorClass ?? 'unknown'}</code></div>
			<div class="text-sm">Failing job IDs: {data.halted.jobIds.join(', ')}</div>
			<div class="mt-3">
				<Button onclick={() => (resumeOpen = true)}>Resume queue</Button>
			</div>
		</section>
	{/if}

	<section class="space-y-2">
		<h2 class="text-lg font-semibold">Status counts</h2>
		<div class="flex flex-wrap gap-2">
			{#each data.counts as c (c.status)}
				<Badge variant="outline">{c.status}: {c.n}</Badge>
			{/each}
			{#if data.counts.length === 0}
				<span class="text-sm text-gray-500">No jobs.</span>
			{/if}
		</div>
	</section>

	<section class="space-y-2">
		<h2 class="text-lg font-semibold">Recent failures</h2>
		{#if data.recentFailed.length === 0}
			<p class="text-sm text-gray-500">No failed jobs.</p>
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
						<Table.Head class="text-right">Actions</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.recentFailed as j (j.id)}
						<Table.Row>
							<Table.Cell>{j.id}</Table.Cell>
							<Table.Cell>{j.attachmentId}</Table.Cell>
							<Table.Cell><Badge variant="outline">{j.status}</Badge></Table.Cell>
							<Table.Cell>{j.attempts}</Table.Cell>
							<Table.Cell>{j.requeueCount}</Table.Cell>
							<Table.Cell><code class="text-xs">{j.lastError ?? ''}</code></Table.Cell>
							<Table.Cell class="text-xs">{j.updatedAt}</Table.Cell>
							<Table.Cell class="text-right space-x-2">
								<form method="POST" action="?/requeue" use:enhance class="inline">
									<input type="hidden" name="csrf" value={page.data.csrfToken} />
									<input type="hidden" name="jobId" value={j.id} />
									<Button size="sm" type="submit">Requeue</Button>
								</form>
								<form method="POST" action="?/abandon" use:enhance class="inline">
									<input type="hidden" name="csrf" value={page.data.csrfToken} />
									<input type="hidden" name="jobId" value={j.id} />
									<Button size="sm" variant="ghost" type="submit">Abandon</Button>
								</form>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</section>

	<AlertDialog.Root bind:open={resumeOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Resume the OCR queue?</AlertDialog.Title>
				<AlertDialog.Description>
					This clears the halt sentinel and resets the consecutive-failure counter. Failed jobs are
					left in their current state — requeue them individually if they should be retried.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/resume"
					use:enhance={() => async ({ update }) => {
						await update();
						resumeOpen = false;
					}}
				>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<AlertDialog.Action type="submit">Resume queue</AlertDialog.Action>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
