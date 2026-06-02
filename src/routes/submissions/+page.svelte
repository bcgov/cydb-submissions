<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { page } from '$app/state';

	let { data }: { data: PageData } = $props();

	function sortHref(col: string) {
		const params = new URLSearchParams(page.url.searchParams);
		const currentSort = params.get('sort') ?? 'date';
		const currentOrder = params.get('order') ?? 'desc';
		params.set('sort', col);
		params.set('order', currentSort === col && currentOrder === 'desc' ? 'asc' : 'desc');
		params.set('page', '1');
		return `?${params.toString()}`;
	}

	function pageHref(p: number) {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('page', String(p));
		return `?${params.toString()}`;
	}

	function statusFilterHref(value: string) {
		const params = new URLSearchParams(page.url.searchParams);
		params.set('status', value);
		params.set('page', '1');
		return `?${params.toString()}`;
	}

	function searchClearHref() {
		const params = new URLSearchParams(page.url.searchParams);
		params.delete('q');
		params.set('page', '1');
		return `?${params.toString()}`;
	}

	const hasQuery = $derived(Boolean(data.query.q));

	// Manticore highlight wraps matches in <b>…</b>. To render with {@html} safely,
	// escape everything, then re-allow only those bold tags.
	function sanitizeSnippet(s: string): string {
		const escaped = s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;');
		return escaped.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
	}

	const filterOptions = [
		{ value: 'exclude_invalid', label: 'All except invalid' },
		{ value: 'all', label: 'All' },
		{ value: 'submitted', label: 'Submitted' },
		{ value: 'invalid', label: 'Invalid' }
	];
</script>

<div class="p-6">
	<h1 class="text-2xl font-semibold mb-4">Submissions</h1>

	<form method="GET" class="mb-4 flex items-center gap-2">
		<input
			type="search"
			name="q"
			value={data.query.q}
			placeholder={'Search all fields — try aut*, "speech delay", @ocr_text vineland'}
			class="w-full max-w-xl rounded border border-gray-300 px-3 py-2 text-sm"
			aria-label="Search submissions"
		/>
		<input type="hidden" name="status" value={data.query.statusFilter} />
		<input type="hidden" name="size" value={data.query.size} />
		<Button type="submit" size="sm">Search</Button>
		{#if hasQuery}
			<a href={searchClearHref()}><Button variant="outline" size="sm">Clear</Button></a>
		{/if}
		<details class="relative">
			<summary class="cursor-pointer text-sm text-blue-700">Advanced syntax</summary>
			<div class="absolute z-10 mt-1 w-80 rounded border border-gray-200 bg-white p-3 text-xs shadow">
				<ul class="space-y-1">
					<li><code>aut*</code> / <code>*ism*</code> — wildcards</li>
					<li><code>"speech delay"</code> — exact phrase</li>
					<li><code>@ocr_text vineland</code> — search one field</li>
					<li><code>"speech delay" NEAR/3</code> — proximity</li>
					<li><code>"adhd anxiety seizures"/2</code> — any 2 of 3</li>
					<li><code>diagnosis -provisional</code> — exclude a term</li>
					<li><code>running</code> matches run / ran (lemmas); typos tolerated automatically</li>
				</ul>
			</div>
		</details>
	</form>

	{#if data.searchError}
		<p class="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
			Invalid search query: {data.searchError}
		</p>
	{/if}
	{#if hasQuery && !data.searchError}
		<p class="mb-2 text-sm text-gray-600">{data.total} result{data.total === 1 ? '' : 's'} for "{data.query.q}", ranked by relevance.</p>
	{/if}

	<div class="mb-4 flex gap-2 flex-wrap">
		{#each filterOptions as opt}
			<a
				href={statusFilterHref(opt.value)}
				class="text-sm px-3 py-1 rounded border {data.query.statusFilter === opt.value
					? 'bg-blue-50 border-blue-300'
					: 'border-gray-200'}"
			>
				{opt.label}
			</a>
		{/each}
	</div>

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>{#if hasQuery}Surname{:else}<a href={sortHref('surname')}>Surname</a>{/if}</Table.Head>
				<Table.Head>{#if hasQuery}Submitted{:else}<a href={sortHref('date')}>Submitted</a>{/if}</Table.Head>
				<Table.Head>{#if hasQuery}Attachments{:else}<a href={sortHref('attachments')}>Attachments</a>{/if}</Table.Head>
				<Table.Head>{#if hasQuery}Status{:else}<a href={sortHref('status')}>Status</a>{/if}</Table.Head>
				<Table.Head></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.rows as row (row.uuid)}
				<Table.Row>
					<Table.Cell>{row.surname ?? '—'}</Table.Cell>
					<Table.Cell>{new Date(row.submittedAt).toLocaleString()}</Table.Cell>
					<Table.Cell>{row.attachmentCount}</Table.Cell>
					<Table.Cell><StatusBadge status={row.status as never} /></Table.Cell>
					<Table.Cell><a class="text-blue-700 underline" href="/submissions/{row.uuid}">View</a></Table.Cell>
				</Table.Row>
				{#if hasQuery && 'snippet' in row && row.snippet}
					<Table.Row>
						<Table.Cell colspan={5}>
							<span class="text-xs text-gray-600">…{@html sanitizeSnippet(String(row.snippet))}…</span>
						</Table.Cell>
					</Table.Row>
				{/if}
			{:else}
				<Table.Row>
					<Table.Cell colspan={5}>No submissions match this filter.</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	<div class="mt-4 flex items-center justify-between text-sm text-gray-700">
		<span>Page {data.query.page} of {data.totalPages} • {data.total} total</span>
		<div class="flex gap-2">
			{#if data.query.page > 1}
				<a href={pageHref(data.query.page - 1)}><Button variant="outline" size="sm">Previous</Button></a>
			{/if}
			{#if data.query.page < data.totalPages}
				<a href={pageHref(data.query.page + 1)}><Button variant="outline" size="sm">Next</Button></a>
			{/if}
		</div>
	</div>
</div>
