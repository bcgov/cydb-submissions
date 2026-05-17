<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="p-6 max-w-3xl mx-auto space-y-8">
	<div>
		<h1 class="text-2xl font-semibold mb-2">CHEFS ingestion</h1>
		<p class="text-gray-700">
			Configure the connection to BC Gov CHEFS so this app can pull submissions from
			the hosted form. Environment variables override DB values; effective values are
			shown below.
		</p>
	</div>

	{#if form?.success}
		<p role="status" class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{form.success}</p>
	{/if}
	{#if form?.error}
		<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{form.error}</p>
	{/if}

	{#if data.halted}
		<section class="rounded border-l-4 border-red-500 bg-red-50 p-4">
			<div class="font-semibold text-red-900">Poller halted at {data.halted.trippedAt}</div>
			<div class="text-sm mt-1">Last error class: <code>{data.halted.lastErrorClass ?? 'unknown'}</code></div>
			<form method="POST" action="?/resume" use:enhance class="mt-3">
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<Button type="submit">Resume poller</Button>
			</form>
		</section>
	{/if}

	<Card.Root>
		<Card.Header><Card.Title>Connection</Card.Title></Card.Header>
		<Card.Content class="space-y-4">
			<form method="POST" action="?/save" use:enhance class="space-y-4">
				<input type="hidden" name="csrf" value={page.data.csrfToken} />

				<div>
					<Label for="formId">Form ID</Label>
					<Input id="formId" name="formId" value={data.config.formId} placeholder="UUID from CHEFS form URL" />
					{#if data.config.envOverrides.includes('formId')}
						<p class="text-xs text-amber-700 mt-1">Overridden by <code>CHEFS_FORM_ID</code></p>
					{/if}
				</div>

				<div>
					<Label for="baseUrl">Base URL</Label>
					<Input id="baseUrl" name="baseUrl" value={data.config.baseUrl} />
				</div>

				<div>
					<Label for="version">Version</Label>
					<Input id="version" name="version" value={data.config.version} />
					<p class="text-xs text-gray-600 mt-1">"0" = all versions (CHEFS default for JSON export).</p>
				</div>

				<div>
					<Label for="fileComponents">File components (comma-separated)</Label>
					<Input id="fileComponents" name="fileComponents" value={data.config.fileComponents.join(',')} />
				</div>

				<div>
					<Label for="apiParams">API params (JSON)</Label>
					<Textarea
						id="apiParams"
						name="apiParams"
						rows={4}
						value={JSON.stringify(data.config.apiParams, null, 2)}
					/>
				</div>

				<div class="flex items-center gap-2">
					<input id="pollerEnabled" type="checkbox" name="pollerEnabled" checked={data.config.pollerEnabled} />
					<Label for="pollerEnabled">Enable background poller</Label>
				</div>

				<div>
					<Label for="pollIntervalMs">Poll interval (ms)</Label>
					<Input id="pollIntervalMs" name="pollIntervalMs" type="number" value={String(data.config.pollIntervalMs)} />
				</div>

				<Button type="submit">Save configuration</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>API token</Card.Title></Card.Header>
		<Card.Content class="space-y-3">
			<p class="text-sm">
				Token status:
				{#if data.config.apiTokenSet}
					<Badge variant="outline">set — source: {data.config.apiTokenSource}</Badge>
				{:else}
					<Badge variant="outline">not set</Badge>
				{/if}
			</p>
			<form method="POST" action="?/rotateToken" use:enhance class="space-y-3">
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<Input name="apiToken" type="password" placeholder="paste new token" autocomplete="off" />
				<Button type="submit" variant="outline">Rotate token</Button>
			</form>
			<p class="text-xs text-gray-600">The token is never echoed to the browser. Stored plaintext in the DB; rotate via this page or via <code>CHEFS_API_TOKEN</code> env (env wins).</p>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header><Card.Title>Operations</Card.Title></Card.Header>
		<Card.Content class="space-y-3">
			<form method="POST" action="?/test" use:enhance class="inline">
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<Button type="submit" variant="outline">Test connection</Button>
			</form>
			<form method="POST" action="?/syncNow" use:enhance class="inline">
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<Button type="submit">Sync now</Button>
			</form>

			<div class="text-sm text-gray-700 pt-3">
				<div>Consecutive failures: <code>{data.failureCount}</code></div>
				{#if data.lastSync}
					<div class="mt-1">
						Last sync at <code>{data.lastSync.finishedAt}</code> —
						fetched <code>{data.lastSync.fetched}</code>,
						ingested <code>{data.lastSync.ingested}</code>,
						invalid <code>{data.lastSync.invalid}</code>,
						skipped <code>{data.lastSync.skippedDuplicate}</code>.
					</div>
				{:else}
					<div class="mt-1">No sync has run yet.</div>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>
</div>
