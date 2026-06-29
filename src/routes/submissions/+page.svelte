<script lang="ts">
	import type { PageData } from './$types';
	import * as Table from '$lib/components/ui/table';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import { Button } from '$lib/components/ui/button';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { formatDate } from '$lib/format-date';

	let { data }: { data: PageData } = $props();

	// Whole-row navigation (mouse enhancement; the "View" link remains the
	// keyboard-accessible path). Don't navigate when the user is selecting text.
	function openRow(uuid: string, isInvalid = false) {
		if (window.getSelection()?.toString()) return;
		goto(isInvalid ? `/submissions/invalid/${uuid}` : `/submissions/${uuid}`);
	}

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
		const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return escaped.replace(/&lt;b&gt;/g, '<b>').replace(/&lt;\/b&gt;/g, '</b>');
	}

	const filterOptions = [
		{ value: 'exclude_invalid', label: 'All except invalid' },
		{ value: 'submitted', label: 'Submitted' },
		{ value: 'accepted', label: 'Accepted' },
		{ value: 'rejected', label: 'Rejected' },
		{ value: 'invalid', label: 'Invalid' },
		{ value: 'ocr_processed', label: 'OCR processed' }
	];
</script>

<div class="p-6">
	<h1 class="mb-4 mx-auto max-w-3xl text-2xl font-semibold">Submissions</h1>

	<form method="GET" class="mb-4 mx-auto max-w-3xl flex items-center gap-2">
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
			<div
				class="absolute z-10 mt-1 w-80 rounded border border-gray-200 bg-white p-3 text-xs shadow"
			>
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
		<p class="mb-4 mx-auto max-w-3xl rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
			Invalid search query: {data.searchError}
		</p>
	{/if}
	{#if hasQuery && !data.searchError}
		<p class="mb-2 mx-auto max-w-3xl text-sm text-gray-600">
			{data.total} result{data.total === 1 ? '' : 's'} for "{data.query.q}", ranked by relevance.
		</p>
	{/if}

	<div class="mb-4 mx-auto max-w-3xl flex flex-wrap gap-2">
		{#each filterOptions as opt}
			<a
				href={statusFilterHref(opt.value)}
				class="rounded border px-3 py-1 text-sm {data.query.statusFilter === opt.value
					? 'border-blue-300 bg-blue-50'
					: 'border-gray-200'}"
			>
				{opt.label}
			</a>
		{/each}
	</div>

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head><a href={sortHref('date')}>Submitted</a></Table.Head>
				<Table.Head>Child</Table.Head>
				<Table.Head><a href={sortHref('surname')}>Signatory surname</a></Table.Head>
				<Table.Head><a href={sortHref('screening')}>Screening</a></Table.Head>
				<Table.Head><a href={sortHref('assessments')}># Assessments</a></Table.Head>
				<Table.Head><a href={sortHref('status')}>Status</a></Table.Head>
				<Table.Head><a href={sortHref('total')}>Total from all categories</a></Table.Head>
				<Table.Head><a href={sortHref('category1')}>{data.categoryMap?.get('category1') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category2')}>{data.categoryMap?.get('category2') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category3')}>{data.categoryMap?.get('category3') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category4')}>{data.categoryMap?.get('category4') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category5')}>{data.categoryMap?.get('category5') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category6')}>{data.categoryMap?.get('category6') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category7')}>{data.categoryMap?.get('category7') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category8')}>{data.categoryMap?.get('category8') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category9')}>{data.categoryMap?.get('category9') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category10')}>{data.categoryMap?.get('category10') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category11')}>{data.categoryMap?.get('category11') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category12')}>{data.categoryMap?.get('category12') ?? 'Undefined'}</a></Table.Head>
				<Table.Head><a href={sortHref('category13')}>{data.categoryMap?.get('category13') ?? 'Undefined'}</a></Table.Head>
				<Table.Head></Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.rows as row (row.uuid)}
				{@const isInvalid = 'isInvalidSubmission' in row && row.isInvalidSubmission}
				<Table.Row class="cursor-pointer hover:bg-muted/50" onclick={() => openRow(row.uuid, isInvalid)}>
					<Table.Cell class="whitespace-nowrap">{formatDate(row.submittedAt)}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.childYouthFirstName} {row.childYouthLastName}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.surname ?? '—'}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.screening}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{isInvalid ? row.attachmentCount : row.assessments?.length ?? 0}</Table.Cell>
					<Table.Cell class="whitespace-nowrap"><StatusBadge status={row.status as never} /></Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.total}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category1}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category2}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category3}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category4}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category5}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category6}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category7}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category8}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category9}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category10}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category11}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category12}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.category13}</Table.Cell>
					<Table.Cell>
						<a class="text-blue-700 underline" href={isInvalid ? `/submissions/invalid/${row.uuid}` : `/submissions/${row.uuid}`}>View</a>
					</Table.Cell>
				</Table.Row>
				{#if hasQuery && 'snippet' in row && row.snippet}
					<Table.Row>
						<Table.Cell colspan={7}>
							<span class="text-xs text-gray-600"
								>…{@html sanitizeSnippet(String(row.snippet))}…</span
							>
						</Table.Cell>
					</Table.Row>
				{/if}
			{/each}
			{#each data.invalidRows as row (row.uuid)}
				<Table.Row class="cursor-pointer hover:bg-muted/50" onclick={() => goto(`/submissions/invalid/${row.uuid}`)}>
					<Table.Cell class="whitespace-nowrap">{formatDate(row.receivedAt)}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.childYouthFirstName}{row.childYouthLastName === '—' && row.childYouthFirstName === '—' ? '' : ' ' + row.childYouthLastName}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.surname}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.screening}</Table.Cell>
					<Table.Cell class="whitespace-nowrap">{row.assessments}</Table.Cell>
					<Table.Cell class="whitespace-nowrap"><StatusBadge status={'invalid' as never} /></Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell>—</Table.Cell>
					<Table.Cell
						><a class="text-blue-700 underline" href="/submissions/invalid/{row.uuid}">View</a></Table.Cell
					>
				</Table.Row>
			{/each}
			{#if data.rows.length === 0 && data.invalidRows.length === 0}
				<Table.Row>
					<Table.Cell colspan={7}>No submissions match this filter.</Table.Cell>
				</Table.Row>
			{/if}
		</Table.Body>
	</Table.Root>

	<div class="mt-4 flex items-center justify-between text-sm text-gray-700">
		<span>Page {data.query.page} of {data.totalPages} • {data.total} total</span>
		<div class="flex gap-2">
			{#if data.query.page > 1}
				<a href={pageHref(data.query.page - 1)}
					><Button variant="outline" size="sm">Previous</Button></a
				>
			{/if}
			{#if data.query.page < data.totalPages}
				<a href={pageHref(data.query.page + 1)}><Button variant="outline" size="sm">Next</Button></a
				>
			{/if}
		</div>
	</div>
</div>
