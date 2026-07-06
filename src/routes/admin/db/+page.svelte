<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	let loading = $state(false);
	let deleteTarget = $state<string | null>(null);
</script>

<div class="mx-auto max-w-2xl space-y-8 p-6">
	<div>
		<h1 class="mb-2 text-2xl font-semibold">Database backup</h1>
		<p class="text-gray-700">
			Create an online backup of the database using SQLite's <code>VACUUM INTO</code>. Scheduled
			backups run nightly and are pruned automatically. Manual backups are kept until deleted.
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
		<h2 class="text-lg font-semibold">Create manual backup</h2>
		<form
			method="POST"
			action="?/backup"
			use:enhance={() => {
				loading = true;
				return async ({ update }) => {
					await update();
					loading = false;
				};
			}}
		>
			<input type="hidden" name="csrf" value={page.data.csrfToken} />
			<Button type="submit" variant="outline" disabled={loading}>
				{loading ? 'Creating backup…' : 'Create backup now'}
			</Button>
		</form>
		<p class="text-xs text-gray-600">
			Produces a compact, consistent copy of the live database. May take a few seconds on large
			databases.
		</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Manual backups</h2>
		{#if data.manual.length === 0}
			<p class="text-sm text-gray-500">No manual backups found.</p>
		{:else}
			<ul class="divide-y rounded border text-sm">
				{#each data.manual as backup}
					<li class="flex items-center justify-between px-3 py-2">
						<code class="font-mono text-xs">{backup.name}</code>
						<div class="flex items-center gap-3">
							<span class="text-gray-500">{(backup.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
							<Button
								variant="destructive"
								size="sm"
								onclick={() => (deleteTarget = backup.name)}
							>
								Delete
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Scheduled backups</h2>
		{#if data.scheduled.length === 0}
			<p class="text-sm text-gray-500">No scheduled backups found.</p>
		{:else}
			<ul class="divide-y rounded border text-sm">
				{#each data.scheduled as backup}
					<li class="flex items-center justify-between px-3 py-2">
						<code class="font-mono text-xs">{backup.name}</code>
						<span class="text-gray-500">{(backup.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="text-xs text-gray-600">Nightly. Oldest removed automatically after {10} are accumulated.</p>
	</section>

	<a href="/admin" class="text-sm text-blue-700 underline">← Back to admin</a>
</div>

<!-- Delete manual backup confirmation -->
<AlertDialog.Root open={deleteTarget !== null} onOpenChange={(o) => { if (!o) deleteTarget = null; }}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete backup?</AlertDialog.Title>
			<AlertDialog.Description>
				<code class="font-mono text-xs">{deleteTarget}</code> will be permanently deleted.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="POST"
				action="?/deleteBackup"
				use:enhance={() =>
					async ({ update }) => {
						await update();
						deleteTarget = null;
					}}
			>
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<input type="hidden" name="name" value={deleteTarget ?? ''} />
				<AlertDialog.Action type="submit" class="bg-red-600 text-white hover:bg-red-700">
					Delete
				</AlertDialog.Action>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
