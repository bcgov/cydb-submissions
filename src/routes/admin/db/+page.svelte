<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	let loading = $state(false);
</script>

<div class="mx-auto max-w-2xl space-y-8 p-6">
	<div>
		<h1 class="mb-2 text-2xl font-semibold">Database backup</h1>
		<p class="text-gray-700">
			Create an online backup of the database using SQLite's <code>VACUUM INTO</code>. The backup
			is written to the same directory as the live database file on the db PVC.
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
		<h2 class="text-lg font-semibold">Create backup</h2>
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
		<h2 class="text-lg font-semibold">Existing backups</h2>
		{#if data.backups.length === 0}
			<p class="text-sm text-gray-500">No backups found.</p>
		{:else}
			<ul class="divide-y rounded border text-sm">
				{#each data.backups as backup}
					<li class="flex items-center justify-between px-3 py-2">
						<code class="font-mono text-xs">{backup.name}</code>
						<span class="text-gray-500">{(backup.sizeBytes / 1024 / 1024).toFixed(2)} MB</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<a href="/admin" class="text-sm text-blue-700 underline">← Back to admin</a>
</div>
