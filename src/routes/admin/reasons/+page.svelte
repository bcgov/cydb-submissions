<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="mx-auto max-w-3xl space-y-8 p-6">
	<div>
		<h1 class="mb-2 text-2xl font-semibold">Accept Reasons</h1>
		<p class="text-gray-700">
			These reasons appear when a reviewer accepts a submission. Deactivating hides a reason from
			new acceptances without altering past decisions.
		</p>
	</div>

	{#if form?.success && (form?.action === 'addAccept' || form?.action === 'editAccept' || form?.action === 'setActiveAccept') }
		<p
			role="status"
			class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
		>
			{form.success}
		</p>
	{/if}
	{#if form?.error && (form?.action === 'addAccept' || form?.action === 'editAccept' || form?.action === 'setActiveAccept')}
		<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
			{form.error}
		</p>
	{/if}

	<!-- Add form -->
	<form
		method="POST"
		action="?/addAccept"
		use:enhance={() =>
			async ({ update }) => {
				await update();
			}}
		class="flex items-end gap-3"
	>
		<input type="hidden" name="csrf" value={page.data.csrfToken} />
		<div class="flex-1">
			<label class="mb-1 block text-sm font-medium text-gray-700" for="new-reason-text">
				New reason
			</label>
			<input
				id="new-reason-text"
				type="text"
				name="text"
				class="w-full rounded border border-gray-300 px-3 py-2 text-sm"
				placeholder="e.g. Insufficient documentation"
			/>
		</div>
		<Button type="submit">Add</Button>
	</form>

	<!-- Reasons table -->
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Text</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>Actions</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.acceptReasons as reason (reason.id)}
				<Table.Row>
					<!-- Inline edit form -->
					<Table.Cell>
						<form
							method="POST"
							action="?/editAccept"
							use:enhance={() =>
								async ({ update }) => {
									await update();
								}}
							class="flex items-center gap-2"
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<input type="hidden" name="id" value={reason.id} />
							<input
								type="text"
								name="text"
								value={reason.text}
								class="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
							/>
							<Button type="submit" variant="outline" size="sm">Save</Button>
						</form>
					</Table.Cell>

					<!-- Status badge -->
					<Table.Cell>
						{#if reason.active}
							<Badge variant="default">Active</Badge>
						{:else}
							<Badge variant="secondary">Inactive</Badge>
						{/if}
					</Table.Cell>

					<!-- Deactivate / Reactivate toggle -->
					<Table.Cell>
						<form
							method="POST"
							action="?/setActiveAccept"
							use:enhance={() =>
								async ({ update }) => {
									await update();
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<input type="hidden" name="id" value={reason.id} />
							<input type="hidden" name="active" value={(!reason.active).toString()} />
							<Button type="submit" variant={reason.active ? 'destructive' : 'outline'} size="sm">
								{reason.active ? 'Deactivate' : 'Reactivate'}
							</Button>
						</form>
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={3}>No accept reasons defined yet.</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>

	<div>
		<h1 class="mb-2 text-2xl font-semibold">Rejection Reasons</h1>
		<p class="text-gray-700">
			These reasons appear when a reviewer rejects a submission. Deactivating hides a reason from
			new rejections without altering past decisions.
		</p>
	</div>

	{#if form?.success && (form?.action === 'add' || form?.action === 'edit' || form?.action === 'setActive')}
		<p
			role="status"
			class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
		>
			{form.success}
		</p>
	{/if}
	{#if form?.error && (form?.action === 'add' || form?.action === 'edit' || form?.action === 'setActive')}
		<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
			{form.error}
		</p>
	{/if}

	<!-- Add form -->
	<form
		method="POST"
		action="?/add"
		use:enhance={() =>
			async ({ update }) => {
				await update();
			}}
		class="flex items-end gap-3"
	>
		<input type="hidden" name="csrf" value={page.data.csrfToken} />
		<div class="flex-1">
			<label class="mb-1 block text-sm font-medium text-gray-700" for="new-reason-text">
				New reason
			</label>
			<input
				id="new-reason-text"
				type="text"
				name="text"
				class="w-full rounded border border-gray-300 px-3 py-2 text-sm"
				placeholder="e.g. Insufficient documentation"
			/>
		</div>
		<Button type="submit">Add</Button>
	</form>

	<!-- Reasons table -->
	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>Text</Table.Head>
				<Table.Head>Status</Table.Head>
				<Table.Head>Actions</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.reasons as reason (reason.id)}
				<Table.Row>
					<!-- Inline edit form -->
					<Table.Cell>
						<form
							method="POST"
							action="?/edit"
							use:enhance={() =>
								async ({ update }) => {
									await update();
								}}
							class="flex items-center gap-2"
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<input type="hidden" name="id" value={reason.id} />
							<input
								type="text"
								name="text"
								value={reason.text}
								class="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
							/>
							<Button type="submit" variant="outline" size="sm">Save</Button>
						</form>
					</Table.Cell>

					<!-- Status badge -->
					<Table.Cell>
						{#if reason.active}
							<Badge variant="default">Active</Badge>
						{:else}
							<Badge variant="secondary">Inactive</Badge>
						{/if}
					</Table.Cell>

					<!-- Deactivate / Reactivate toggle -->
					<Table.Cell>
						<form
							method="POST"
							action="?/setActive"
							use:enhance={() =>
								async ({ update }) => {
									await update();
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<input type="hidden" name="id" value={reason.id} />
							<input type="hidden" name="active" value={(!reason.active).toString()} />
							<Button type="submit" variant={reason.active ? 'destructive' : 'outline'} size="sm">
								{reason.active ? 'Deactivate' : 'Reactivate'}
							</Button>
						</form>
					</Table.Cell>
				</Table.Row>
			{:else}
				<Table.Row>
					<Table.Cell colspan={3}>No rejection reasons defined yet.</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
