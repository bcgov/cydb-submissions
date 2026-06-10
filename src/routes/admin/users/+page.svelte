<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Table from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { formatDate } from '$lib/format-date';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Track which revoke dialog is open: "<userId>:<role>" or null
	let revokeDialogKey = $state<string | null>(null);
	// Per-dialog reason text, keyed the same way
	let reasonMap = $state<Record<string, string>>({});

	function revokeKey(userId: string, role: string) {
		return `${userId}:${role}`;
	}

	function isRevoked(row: PageData['rows'][number], role: string): boolean {
		return row.revoked.some((r) => r.role === role);
	}

	// Resolve an actor's user id (stored on a revocation) to a human label.
	function userLabel(id: string): string {
		return data.rows.find((r) => r.id === id)?.email ?? id;
	}

	// How many users currently hold `admin` as an EFFECTIVE role.
	const effectiveAdminCount = $derived(
		data.rows.filter((r) => r.effective.includes('admin')).length
	);

	// Revoking admin from the only remaining effective admin would leave none.
	function isLastEffectiveAdmin(row: PageData['rows'][number], role: string): boolean {
		return role === 'admin' && row.effective.includes('admin') && effectiveAdminCount <= 1;
	}

	const roleBadgeVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
		admin: 'default',
		cfd_worker: 'secondary',
		clinician: 'outline'
	};
</script>

<div class="mx-auto max-w-5xl space-y-8 p-6">
	<div>
		<h1 class="mb-2 text-2xl font-semibold">User Roles &amp; Revocation</h1>
		<p class="text-gray-700">
			Review and manage role assignments. Revocations override the identity provider immediately and
			remain in effect until explicitly restored — even if the IdP still reports the role as
			granted.
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

	<Table.Root>
		<Table.Header>
			<Table.Row>
				<Table.Head>User</Table.Head>
				<Table.Head>Granted</Table.Head>
				<Table.Head>Revoked</Table.Head>
				<Table.Head>Effective</Table.Head>
				<Table.Head>Actions</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each data.rows as row (row.id)}
				<Table.Row>
					<Table.Cell>
						<div class="font-medium">{row.name}</div>
						<div class="text-xs text-gray-500">{row.email}</div>
					</Table.Cell>

					<!-- Granted roles -->
					<Table.Cell>
						<div class="flex flex-wrap gap-1">
							{#each row.granted as role (role)}
								<Badge variant={roleBadgeVariant[role] ?? 'outline'}>{role}</Badge>
							{:else}
								<span class="text-xs text-gray-400">none</span>
							{/each}
						</div>
					</Table.Cell>

					<!-- Revoked roles with reason + date -->
					<Table.Cell>
						<div class="flex flex-col gap-1">
							{#each row.revoked as rev (rev.role)}
								<div class="flex flex-col gap-0.5">
									<Badge variant="destructive">{rev.role}</Badge>
									{#if rev.reason}
										<span class="text-xs text-gray-600">{rev.reason}</span>
									{/if}
									<span class="text-xs text-gray-400"
										>by {userLabel(rev.revokedBy)} on {formatDate(rev.revokedAt)}</span
									>
								</div>
							{:else}
								<span class="text-xs text-gray-400">none</span>
							{/each}
						</div>
					</Table.Cell>

					<!-- Effective roles -->
					<Table.Cell>
						<div class="flex flex-wrap gap-1">
							{#each row.effective as role (role)}
								<Badge variant={roleBadgeVariant[role] ?? 'outline'}>{role}</Badge>
							{:else}
								<span class="text-xs text-gray-400">none</span>
							{/each}
						</div>
					</Table.Cell>

					<!-- Actions -->
					<Table.Cell>
						<div class="flex flex-col gap-2">
							<!-- Revoke buttons for granted roles not yet revoked -->
							{#each row.granted as role (role)}
								{#if !isRevoked(row, role)}
									{@const isSelfAdmin = row.id === data.currentUserId && role === 'admin'}
									{#if isSelfAdmin}
										<span class="text-xs text-gray-400 italic">can't revoke your own admin</span>
									{:else}
										<Button
											variant="destructive"
											size="sm"
											onclick={() => (revokeDialogKey = revokeKey(row.id, role))}
										>
											Revoke {role}
										</Button>
									{/if}
								{/if}
							{/each}

							<!-- Restore buttons for revoked roles -->
							{#each row.revoked as rev (rev.role)}
								<form
									method="POST"
									action="?/restore"
									use:enhance={() =>
										async ({ update }) => {
											await update();
										}}
								>
									<input type="hidden" name="csrf" value={page.data.csrfToken} />
									<input type="hidden" name="userId" value={row.id} />
									<input type="hidden" name="role" value={rev.role} />
									<Button variant="outline" size="sm" type="submit">Restore {rev.role}</Button>
								</form>
							{/each}
						</div>
					</Table.Cell>
				</Table.Row>

				<!-- Revoke dialogs for this row — one per granted+not-revoked role -->
				{#each row.granted as role (role)}
					{#if !isRevoked(row, role) && !(row.id === data.currentUserId && role === 'admin')}
						{@const key = revokeKey(row.id, role)}
						<AlertDialog.Root
							open={revokeDialogKey === key}
							onOpenChange={(open) => {
								if (!open) revokeDialogKey = null;
							}}
						>
							<AlertDialog.Content>
								<AlertDialog.Header>
									<AlertDialog.Title>Revoke {role} from {row.name}?</AlertDialog.Title>
									<AlertDialog.Description>
										This will immediately remove the <strong>{role}</strong> role for
										<strong>{row.email}</strong>, overriding the identity provider until you
										explicitly restore it. This action is logged.
									</AlertDialog.Description>
									{#if isLastEffectiveAdmin(row, role)}
										<p
											role="alert"
											class="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
										>
											Warning: this is the last remaining admin. Revoking it will leave no one with
											admin access.
										</p>
									{/if}
								</AlertDialog.Header>
								<div class="px-6 pb-2">
									<label class="block text-sm font-medium text-gray-700" for="reason-{key}">
										Reason <span class="font-normal text-gray-500">(optional)</span>
									</label>
									<input
										id="reason-{key}"
										type="text"
										class="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
										placeholder="e.g. Left organisation"
										bind:value={reasonMap[key]}
									/>
								</div>
								<AlertDialog.Footer>
									<AlertDialog.Cancel onclick={() => (revokeDialogKey = null)}>
										Cancel
									</AlertDialog.Cancel>
									<form
										method="POST"
										action="?/revoke"
										use:enhance={() =>
											async ({ update }) => {
												await update();
												revokeDialogKey = null;
												reasonMap[key] = '';
											}}
									>
										<input type="hidden" name="csrf" value={page.data.csrfToken} />
										<input type="hidden" name="userId" value={row.id} />
										<input type="hidden" name="role" value={role} />
										<input type="hidden" name="reason" value={reasonMap[key] ?? ''} />
										<AlertDialog.Action
											type="submit"
											class="bg-red-600 text-white hover:bg-red-700"
										>
											Revoke
										</AlertDialog.Action>
									</form>
								</AlertDialog.Footer>
							</AlertDialog.Content>
						</AlertDialog.Root>
					{/if}
				{/each}
			{:else}
				<Table.Row>
					<Table.Cell colspan={5}>No users found.</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
