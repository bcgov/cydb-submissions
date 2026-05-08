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

	const filterOptions = [
		{ value: 'exclude_invalid', label: 'All except invalid' },
		{ value: 'all', label: 'All' },
		{ value: 'submitted', label: 'Submitted' },
		{ value: 'invalid', label: 'Invalid' }
	];
</script>

<div class="p-6">
	<h1 class="text-2xl font-semibold mb-4">Submissions</h1>

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
				<Table.Head><a href={sortHref('surname')}>Surname</a></Table.Head>
				<Table.Head><a href={sortHref('date')}>Submitted</a></Table.Head>
				<Table.Head><a href={sortHref('attachments')}>Attachments</a></Table.Head>
				<Table.Head><a href={sortHref('status')}>Status</a></Table.Head>
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
