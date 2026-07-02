<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData } from './$types';
	import type { PageData } from './$types';

	let { form, data }: { form: ActionData, data: PageData } = $props();

	let seedOpen = $state(false);
	let clearOpen = $state(false);
	let clearInvalidOpen = $state(false);
</script>

<div class="mx-auto max-w-2xl space-y-8 p-6">
	<div>
		<h1 class="mb-2 text-2xl font-semibold">Administration</h1>
		<p class="text-gray-700">
			Phase 2 admin tooling: database seed + clear. Role management and queue controls arrive in
			Phases 3–4.
		</p>
	</div>

	{#if form?.success}
		<p
			role="status"
			class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
		>
			{form.success}
		</p>
	{/if}
	{#if form?.error}
		<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
			{form.error}
		</p>
	{/if}

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Database</h2>

		<div class="flex flex-wrap gap-3">
			<Button variant="outline" onclick={() => (seedOpen = true)}>Seed mock submissions</Button>
			{#if data?.canDelete}
			<Button variant="destructive" onclick={() => (clearOpen = true)}>Clear all submissions</Button
			>
			{/if}
			<Button variant="destructive" onclick={() => (clearInvalidOpen = true)}>Clear invalid &amp; re-ingest</Button>
		</div>

		<p class="text-xs text-gray-600">
			Seed inserts 12 mock submissions (10 valid, 2 invalid) plus a handful of placeholder
			attachments, including extracted OCR text on completed reports so document-content search is
			testable. Clear removes all submissions, metadata, attachments, OCR results, and invalid
			records — users and roles are untouched.
		</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Pipeline</h2>
		<div class="flex flex-col gap-1">
			<a href="/admin/queues" class="text-blue-700 underline">Queue pipeline dashboard →</a>
			<a href="/admin/chefs" class="text-blue-700 underline">CHEFS configuration &amp; sync →</a>
			<a href="/admin/ocr" class="text-blue-700 underline">OCR queue detail →</a>
		</div>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Access control</h2>
		<div class="flex flex-col gap-1">
			<a href="/admin/users" class="text-blue-700 underline">User roles &amp; revocation →</a>
			<a href="/admin/reasons" class="text-blue-700 underline">Rejection reasons →</a>
		</div>
	</section>

	<!-- Seed confirmation -->
	<AlertDialog.Root bind:open={seedOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Seed mock submissions?</AlertDialog.Title>
				<AlertDialog.Description>
					This will <strong>replace all existing submissions</strong> with 12 mock records and write placeholder
					attachment files to disk. Useful for local testing — do not run in production.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/seed"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							seedOpen = false;
						}}
				>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<AlertDialog.Action type="submit">Seed</AlertDialog.Action>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<!-- Clear invalid & re-ingest confirmation -->
	<AlertDialog.Root bind:open={clearInvalidOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Clear invalid submissions and re-ingest?</AlertDialog.Title>
				<AlertDialog.Description>
					This removes all invalid submission records and immediately re-syncs from CHEFS.
					Submissions that previously failed validation will be retried.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/clearInvalidAndSync"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							clearInvalidOpen = false;
						}}
				>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<AlertDialog.Action type="submit">Confirm</AlertDialog.Action>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<!-- Clear confirmation -->
	<AlertDialog.Root bind:open={clearOpen}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Clear all submissions?</AlertDialog.Title>
				<AlertDialog.Description>
					This <strong>permanently deletes</strong> every submission, its metadata, all attachment files
					on disk, and all invalid-submission records. Users and roles are not affected. There is no undo.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<form
					method="POST"
					action="?/clear"
					use:enhance={() =>
						async ({ update }) => {
							await update();
							clearOpen = false;
						}}
				>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<AlertDialog.Action type="submit" class="bg-red-600 text-white hover:bg-red-700"
						>Clear all</AlertDialog.Action
					>
				</form>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
</div>
