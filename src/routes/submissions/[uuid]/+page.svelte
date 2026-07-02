<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';
	import SubmissionView from '$lib/components/view/SubmissionView.svelte';
	import AttachmentsView from '$lib/components/view/AttachmentsView.svelte';
	import MetadataView from '$lib/components/view/MetadataView.svelte';
	import StatusBadge from '$lib/components/StatusBadge.svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { formatDate } from '$lib/format-date';
	import { beforeNavigate, goto } from '$app/navigation';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Local radio state for the decide form (no default)
	let decisionChoice = $state<'accepted' | 'rejected' | 'provisionally eligible' | null>(null);

	// Local checkbox state for reject reasons, keyed by reason id
	let selectedReasonIds = $state<Record<number, boolean>>({});

	// Whether the decide dialog is open
	let decideDialogOpen = $state(false);

	// Whether the reset dialog is open
	let resetDialogOpen = $state(false);

	// True when a different user holds the claim — editing is locked for us
	const lockedByOther = $derived(data.claim !== null && !data.claimedByMe);

	// Notes textarea state
	let notesValue = $derived(data.submission.levelOfNeedSummary ?? '');
	const notesDirty = $derived(notesValue !== (data.submission.levelOfNeedSummary ?? ''));

	// The decide button is disabled when:
	// - no radio chosen
	// - rejected is chosen but no reason is ticked
	// - there are unsaved notes changes
	const decideDisabled = $derived(
		notesDirty ||
			decisionChoice === null ||
			(decisionChoice === 'rejected' && !Object.values(selectedReasonIds).some((v) => v === true))
	);

	// Ticked reason ids for injection into the hidden form inputs
	const tickedReasonIds = $derived(
		Object.entries(selectedReasonIds)
			.filter(([, checked]) => checked)
			.map(([id]) => Number(id))
	);

	// In 'ready for policy' status, only reject is allowed
	const onlyReject = $derived(data.submission.status === 'ready for policy');

	// Whether the ready-for-clinician dialog is open
	let readyForClinicianDialogOpen = $state(false);
	// Whether the ready-for-validator dialog is open
	let readyForValidatorDialogOpen = $state(false);

	// True after the ready-for-clinician action succeeds
	let readyForClinicianSuccess = $state(false);
		// True after the ready-for-validator action succeeds
	let readyForValidatorSuccess = $state(false);

	// Whether the reset-ready-for-clinician dialog is open
	let resetReadyForClinicianDialogOpen = $state(false);
	// Whether the reset-ready-for-validator dialog is open
	let resetReadyForValidatorDialogOpen = $state(false);

	// Whether the ready-for-validator dialog is open
	let readyForValidatorDialogOpen = $state(false);

	// True after the ready-for-validator action succeeds
	let readyForValidatorSuccess = $state(false);

	// Whether the reset-ready-for-validator dialog is open
	let resetReadyForValidatorDialogOpen = $state(false);

	// Whether the ready-for-policy dialog is open
	let readyForPolicyDialogOpen = $state(false);

	// Whether the provisionally-eligible dialog is open
	let provisionallyEligibleDialogOpen = $state(false);

	beforeNavigate(({cancel}) => {
		if (notesDirty && !confirm('You have unsaved changes to your notes! Discard them?')) {
			cancel(); // Stop navigation if the user cancels
		}
  });
</script>

<div class="mx-auto max-w-3xl space-y-8 p-6">
	<!-- Claim banner -->
	<div
		class="flex items-center justify-between rounded border px-4 py-3 {lockedByOther
			? 'border-amber-200 bg-amber-50'
			: data.claimedByMe
				? 'border-blue-200 bg-blue-50'
				: 'border-gray-200 bg-gray-50'}"
	>
		{#if !data.claim}
			<span class="text-sm text-gray-600">This submission is unclaimed.</span>
			<form method="POST" action="?/claim" use:enhance>
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<Button variant="default" size="sm" type="submit">Claim</Button>
			</form>
		{:else if data.claimedByMe}
			<span class="text-sm text-blue-800">You have claimed this submission.</span>
			<form method="POST" action="?/unclaim" use:enhance>
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<Button variant="outline" size="sm" type="submit">Unclaim</Button>
			</form>
		{:else}
			<span class="text-sm text-amber-800"
				>Claimed by {data.claim.email ?? 'another user'} — editing is locked.</span
			>
			{#if data.isAdmin}
				<form method="POST" action="?/unclaim" use:enhance>
					<input type="hidden" name="csrf" value={page.data.csrfToken} />
					<Button variant="outline" size="sm" type="submit">Force Unclaim</Button>
				</form>
			{/if}
		{/if}
	</div>

	{#if form?.action === 'claim' || form?.action === 'unclaim'}
		{#if form?.success}
			<p
				role="status"
				class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
			>
				{form.success}
			</p>
		{/if}
		{#if form?.error}
			<p
				role="alert"
				class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
			>
				{form.error}
			</p>
		{/if}
	{/if}

	<header class="flex items-center justify-between">
		<div>
			<a href="/submissions" class="text-sm text-blue-700 underline">← Back to submissions</a>
			<h1 class="mt-2 text-2xl font-semibold">Submission {data.submission.submissionUuid}</h1>
		</div>
		<StatusBadge status={data.submission.status as never} />
	</header>

	<!-- Ready-for-policy component -->
	{#if data.claimedByMe && data.canMarkForPolicy && ['ready for review', 'ready for clinician', 'OCR Error'].includes(data.submission.status) && !data.decision.decision}
		<section class="space-y-4 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Send for{#if data.submission.status !== 'ready for review'}&nbsp;policy{/if} review</h2>

			{#if form?.action === 'readyForPolicy' && form?.success}
				<p role="status" class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
					{form.success}
				</p>
			{/if}
			{#if form?.action === 'readyForPolicy' && form?.error}
				<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
					{form.error}
				</p>
			{/if}
			
			<p class="text-sm text-gray-600">Mark this submission as ready for{#if data.submission.status !== 'ready for review'}&nbsp;policy{/if} review.</p>
			<div class="flex flex-wrap gap-3">
				{#if data.submission.status === 'ready for review' && (data.isAdmin || data.isCfdWorker || (!data.isAdmin && !data.isCfdWorker))}
					<Button variant="outline" disabled={notesDirty} onclick={() => (provisionallyEligibleDialogOpen = true)}>
						Mark as provisionally eligible
					</Button>
				{/if}
				<Button variant="outline" disabled={notesDirty} onclick={() => (readyForPolicyDialogOpen = true)}>
					Mark for policy review
				</Button>
			</div>
			{#if notesDirty}
				<p class="text-xs text-amber-600">Save your notes before changing status.</p>
			{/if}

			<!-- Ready for policy dialog -->
			<AlertDialog.Root
				open={readyForPolicyDialogOpen}
				onOpenChange={(open) => { if (!open) readyForPolicyDialogOpen = false; }}
			>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Mark for policy review?</AlertDialog.Title>
						<AlertDialog.Description>
							Are you sure you want to send this submission for policy review?
							{#if !data.canDecide}
								You will not be able to view or modify this submission later.
							{/if}
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel onclick={() => (readyForPolicyDialogOpen = false)}>
							Cancel
						</AlertDialog.Cancel>
						<form
							method="POST"
							action="?/readyForPolicy"
							use:enhance={() =>
								async ({ update }) => {
									await update();
									readyForPolicyDialogOpen = false;
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<AlertDialog.Action type="submit">Confirm</AlertDialog.Action>
						</form>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>

			<!-- Provisionally eligible dialog -->
			<AlertDialog.Root
				open={provisionallyEligibleDialogOpen}
				onOpenChange={(open) => { if (!open) provisionallyEligibleDialogOpen = false; }}
			>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Mark as provisionally eligible?</AlertDialog.Title>
						<AlertDialog.Description>
							This submission will be moved to provisionally eligible status.
							{#if !data.canDecide}
								You will not be able to view or modify this submission later.
							{/if}
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel onclick={() => (provisionallyEligibleDialogOpen = false)}>
							Cancel
						</AlertDialog.Cancel>
						<form
							method="POST"
							action="?/provisionallyEligible"
							use:enhance={() =>
								async ({ update }) => {
									await update();
									provisionallyEligibleDialogOpen = false;
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<AlertDialog.Action type="submit">Confirm</AlertDialog.Action>
						</form>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</section>
	{/if}

	<!-- Decision block — only shown for decidable statuses -->
	{#if ['provisionally eligible', 'ready for policy'].includes(data.submission.status)}
		<section class="space-y-4 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Decision</h2>

			{#if form?.success && form?.action !== 'claim' && form?.action !== 'unclaim' && form?.action !== 'saveNotes'}
				<p
					role="status"
					class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
				>
					{form.success}
				</p>
			{/if}
			{#if form?.error && form?.action !== 'claim' && form?.action !== 'unclaim' && form?.action !== 'saveNotes'}
				<p
					role="alert"
					class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
				>
					{form.error}
				</p>
			{/if}

			{#if data.decision.decision === null && data.canDecide && data.claimedByMe}
				<!-- A) Decision form -->
				<fieldset class="space-y-3">
					<legend class="text-sm font-medium text-gray-700">Record a decision</legend>
					<div class="flex gap-6">
						{#if !onlyReject}
							<label class="flex cursor-pointer items-center gap-2 text-sm">
								<input
									type="radio"
									name="decisionChoice"
									value="accepted"
									checked={decisionChoice === 'accepted'}
									onchange={() => {
										decisionChoice = 'accepted';
										selectedReasonIds = {};
									}}
								/>
								Accept
							</label>
						{/if}
						{#if onlyReject}
						<label class="flex cursor-pointer items-center gap-2 text-sm">
							<input
								type="radio"
								name="decisionChoice"
								value="provisionally eligible"
								checked={decisionChoice === 'provisionally eligible'}
								onchange={() => { decisionChoice = 'provisionally eligible'; selectedReasonIds = {}; }}
							/>
							Provisionally eligible
						</label>
						{/if}
						<label class="flex cursor-pointer items-center gap-2 text-sm">
							<input
								type="radio"
								name="decisionChoice"
								value="rejected"
								checked={decisionChoice === 'rejected'}
								onchange={() => (decisionChoice = 'rejected')}
							/>
							Reject
						</label>
					</div>

					{#if decisionChoice === 'rejected'}
						<div class="space-y-2">
							<p class="text-sm font-medium text-gray-700">Select all that apply</p>
							{#each data.activeReasons as reason (reason.id)}
								<label class="flex cursor-pointer items-center gap-2 text-sm">
									<input
										type="checkbox"
										checked={!!selectedReasonIds[reason.id]}
										onchange={(e) => {
											selectedReasonIds = {
												...selectedReasonIds,
												[reason.id]: (e.currentTarget as HTMLInputElement).checked
											};
										}}
									/>
									{reason.text}
								</label>
							{/each}
						</div>
					{/if}
				</fieldset>

				<Button variant="default" disabled={decideDisabled} onclick={() => (decideDialogOpen = true)}>
					Record decision
				</Button>
				{#if notesDirty && decisionChoice}
					<p class="text-xs text-amber-600">Save your notes before recording a decision.</p>
				{/if}

				<!-- Decide confirm dialog -->
				<AlertDialog.Root
					open={decideDialogOpen}
					onOpenChange={(open) => {
						if (!open) decideDialogOpen = false;
					}}
				>
					<AlertDialog.Content>
						<AlertDialog.Header>
							<AlertDialog.Title>Record decision?</AlertDialog.Title>
							<AlertDialog.Description>
								This decision is final and cannot be changed.
							</AlertDialog.Description>
						</AlertDialog.Header>
						<AlertDialog.Footer>
							<AlertDialog.Cancel onclick={() => (decideDialogOpen = false)}>
								Cancel
							</AlertDialog.Cancel>
						<form
							method="POST"
							action={decisionChoice === 'provisionally eligible' ? '?/provisionallyEligible' : '?/decide'}
							use:enhance={() =>
								async ({ update }) => {
									await update();
									decideDialogOpen = false;
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<input type="hidden" name="decision" value={decisionChoice ?? ''} />
							{#if decisionChoice === 'rejected'}
								{#each tickedReasonIds as id (id)}
									<input type="hidden" name="reasonIds" value={id} />
								{/each}
							{/if}
							<AlertDialog.Action type="submit">Confirm</AlertDialog.Action>
						</form>
						</AlertDialog.Footer>
					</AlertDialog.Content>
				</AlertDialog.Root>
			{:else if data.decision.decision !== null}
				<!-- B) Read-only result -->
				<div class="space-y-2">
					<div class="flex items-center gap-3">
						{#if data.decision.decision === 'accepted'}
							<Badge class="bg-emerald-600 text-white hover:bg-emerald-700">Accepted</Badge>
						{:else}
							<Badge class="bg-rose-600 text-white hover:bg-rose-700">Rejected</Badge>
						{/if}
						<span class="text-sm text-gray-600">
							by {data.decision.decidedByEmail} on {formatDate(data.decision.decidedAt)}
						</span>
					</div>

					{#if data.decision.decision === 'rejected' && data.decision.reasons.length > 0}
						<ul class="ml-4 list-disc space-y-1 text-sm text-gray-700">
							{#each data.decision.reasons as reason (reason)}
								<li>{reason}</li>
							{/each}
						</ul>
					{/if}

					{#if data.isAdmin && data.claimedByMe}
						<Button variant="outline" size="sm" onclick={() => (resetDialogOpen = true)}>
							Reset decision
						</Button>

						<!-- Reset confirm dialog -->
						<AlertDialog.Root
							open={resetDialogOpen}
							onOpenChange={(open) => {
								if (!open) resetDialogOpen = false;
							}}
						>
							<AlertDialog.Content>
								<AlertDialog.Header>
									<AlertDialog.Title>Reset decision?</AlertDialog.Title>
									<AlertDialog.Description>
										This discards the decision and returns the submission to review.
									</AlertDialog.Description>
								</AlertDialog.Header>
								<AlertDialog.Footer>
									<AlertDialog.Cancel onclick={() => (resetDialogOpen = false)}>
										Cancel
									</AlertDialog.Cancel>
									<form
										method="POST"
										action="?/resetDecision"
										use:enhance={() =>
											async ({ update }) => {
												await update();
												resetDialogOpen = false;
											}}
									>
										<input type="hidden" name="csrf" value={page.data.csrfToken} />
										<AlertDialog.Action type="submit">Reset</AlertDialog.Action>
									</form>
								</AlertDialog.Footer>
							</AlertDialog.Content>
						</AlertDialog.Root>
					{/if}
				</div>
			{:else if lockedByOther}
				<p class="text-sm text-amber-700">
					Editing is locked — this submission is claimed by another user.
				</p>
			{:else if data.canDecide}
				<p class="text-sm text-gray-500">Claim this submission to record a decision.</p>
			{:else}
				<p class="text-sm text-gray-500">No decision has been recorded yet.</p>
			{/if}
		</section>
	{/if}

	<!-- Send for review section (clinician / validator) -->
	{#if data.claimedByMe && data.canDecide && data.submission.status === 'OCR processed' && !data.decision.decision}
		<section class="space-y-4 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Send for review</h2>

			<p class="text-sm text-gray-600">
				Send this submission for clinician or validator review.
				Any notes you have saved will be visible to the reviewer.
			</p>

			<div class="flex flex-wrap gap-3">
				<Button variant="outline" disabled={notesDirty} onclick={() => (readyForClinicianDialogOpen = true)}>
					Mark for clinician review
				</Button>
				<Button variant="outline" disabled={notesDirty} onclick={() => (readyForValidatorDialogOpen = true)}>
					Mark for validator review
				</Button>
			</div>
			{#if notesDirty}
				<p class="text-xs text-amber-600">Save your notes before sending for review.</p>
			{/if}

			<AlertDialog.Root
				open={readyForClinicianDialogOpen}
				onOpenChange={(open) => {
					if (!open) readyForClinicianDialogOpen = false;
				}}
			>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Mark for clinician review?</AlertDialog.Title>
						<AlertDialog.Description>
							Are you sure you want to send this submission for clinician review?
							This action cannot be undone.
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel onclick={() => (readyForClinicianDialogOpen = false)}>
							Cancel
						</AlertDialog.Cancel>
						<form
							method="POST"
							action="?/readyForClinician"
							use:enhance={() =>
								async ({ result, update }) => {
									await update({ reset: false });
									if (result.type === 'success') {
										readyForClinicianDialogOpen = false;
										readyForClinicianSuccess = true;
									}
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<AlertDialog.Action type="submit">Confirm</AlertDialog.Action>
						</form>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>

			<AlertDialog.Root
				open={readyForValidatorDialogOpen}
				onOpenChange={(open) => {
					if (!open) readyForValidatorDialogOpen = false;
				}}
			>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Mark for validator review?</AlertDialog.Title>
						<AlertDialog.Description>
							Are you sure you want to send this submission for validator review?
							This action cannot be undone.
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel onclick={() => (readyForValidatorDialogOpen = false)}>
							Cancel
						</AlertDialog.Cancel>
						<form
							method="POST"
							action="?/readyForValidator"
							use:enhance={() =>
								async ({ result, update }) => {
									await update({ reset: false });
									if (result.type === 'success') {
										readyForValidatorDialogOpen = false;
										readyForValidatorSuccess = true;
									}
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<AlertDialog.Action type="submit">Confirm</AlertDialog.Action>
						</form>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</section>
	{/if}

	<!-- Admin: reset ready-for-clinician -->
	{#if data.isAdmin && data.claimedByMe && data.submission.status === 'ready for clinician'}
		<section class="space-y-4 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Ready for Clinician</h2>

			{#if form?.action === 'resetReadyForClinician' && form?.success}
				<p role="status" class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
					{form.success}
				</p>
			{/if}
			{#if form?.action === 'resetReadyForClinician' && form?.error}
				<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
					{form.error}
				</p>
			{/if}

			<p class="text-sm text-gray-600">This submission is currently awaiting clinician review.</p>
			<Button variant="outline" size="sm" onclick={() => (resetReadyForClinicianDialogOpen = true)}>
				Reset status
			</Button>

			<AlertDialog.Root
				open={resetReadyForClinicianDialogOpen}
				onOpenChange={(open) => {
					if (!open) resetReadyForClinicianDialogOpen = false;
				}}
			>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Reset clinician status?</AlertDialog.Title>
						<AlertDialog.Description>
							This will return the submission to the appropriate review status based on its OCR
							processing state.
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel onclick={() => (resetReadyForClinicianDialogOpen = false)}>
							Cancel
						</AlertDialog.Cancel>
						<form
							method="POST"
							action="?/resetReadyForClinician"
							use:enhance={() =>
								async ({ update }) => {
									await update();
									resetReadyForClinicianDialogOpen = false;
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<AlertDialog.Action type="submit">Reset</AlertDialog.Action>
						</form>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</section>
	{:else if data.isAdmin && data.claimedByMe && data.submission.status === 'ready for review'}
		<section class="space-y-4 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Ready for Validator</h2>

			{#if form?.action === 'resetReadyForValidator' && form?.success}
				<p
					role="status"
					class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
				>
					{form.success}
				</p>
			{/if}
			{#if form?.action === 'resetReadyForValidator' && form?.error}
				<p
					role="alert"
					class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
				>
					{form.error}
				</p>
			{/if}

			<p class="text-sm text-gray-600">This submission is currently awaiting validator review.</p>
			<Button variant="outline" size="sm" onclick={() => (resetReadyForValidatorDialogOpen = true)}>
				Reset status
			</Button>

			<AlertDialog.Root
				open={resetReadyForValidatorDialogOpen}
				onOpenChange={(open) => {
					if (!open) resetReadyForValidatorDialogOpen = false;
				}}
			>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Reset validator status?</AlertDialog.Title>
						<AlertDialog.Description>
							This will return the submission to the appropriate review status based on its OCR
							processing state.
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel onclick={() => (resetReadyForValidatorDialogOpen = false)}>
							Cancel
						</AlertDialog.Cancel>
						<form
							method="POST"
							action="?/resetReadyForValidator"
							use:enhance={() =>
								async ({ update }) => {
									await update();
									resetReadyForValidatorDialogOpen = false;
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<AlertDialog.Action type="submit">Reset</AlertDialog.Action>
						</form>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</section>
	{/if}

	<!-- Admin: reset ready-for-validator -->
	{#if data.isAdmin && data.claimedByMe && data.submission.status === 'ready for review'}
		<section class="space-y-4 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Ready for Validator</h2>

			{#if form?.action === 'resetReadyForValidator' && form?.success}
				<p role="status" class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
					{form.success}
				</p>
			{/if}
			{#if form?.action === 'resetReadyForValidator' && form?.error}
				<p role="alert" class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
					{form.error}
				</p>
			{/if}

			<p class="text-sm text-gray-600">This submission is currently awaiting validator review.</p>
			<Button variant="outline" size="sm" onclick={() => (resetReadyForValidatorDialogOpen = true)}>
				Reset status
			</Button>

			<AlertDialog.Root
				open={resetReadyForValidatorDialogOpen}
				onOpenChange={(open) => {
					if (!open) resetReadyForValidatorDialogOpen = false;
				}}
			>
				<AlertDialog.Content>
					<AlertDialog.Header>
						<AlertDialog.Title>Reset validator status?</AlertDialog.Title>
						<AlertDialog.Description>
							This will return the submission to the appropriate review status based on its OCR
							processing state.
						</AlertDialog.Description>
					</AlertDialog.Header>
					<AlertDialog.Footer>
						<AlertDialog.Cancel onclick={() => (resetReadyForValidatorDialogOpen = false)}>
							Cancel
						</AlertDialog.Cancel>
						<form
							method="POST"
							action="?/resetReadyForValidator"
							use:enhance={() =>
								async ({ update }) => {
									await update();
									resetReadyForValidatorDialogOpen = false;
								}}
						>
							<input type="hidden" name="csrf" value={page.data.csrfToken} />
							<AlertDialog.Action type="submit">Reset</AlertDialog.Action>
						</form>
					</AlertDialog.Footer>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</section>
	{/if}

	<!-- Success dialogs after redirect-less transitions -->
	<AlertDialog.Root
		open={readyForClinicianSuccess}
		onOpenChange={(open) => {
			if (!open) goto('/submissions');
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Marked for clinician review</AlertDialog.Title>
				<AlertDialog.Description>
					This submission has been successfully marked for clinician review.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Action onclick={() => goto('/submissions')}>
					Return to submissions
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<AlertDialog.Root
		open={readyForValidatorSuccess}
		onOpenChange={(open) => {
			if (!open) goto('/submissions');
		}}
	>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Marked for validator review</AlertDialog.Title>
				<AlertDialog.Description>
					This submission has been successfully marked for validator review.
				</AlertDialog.Description>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Action onclick={() => goto('/submissions')}>
					Return to submissions
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	{#if data.claimedByMe}
		<section class="space-y-3 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Notes about submission</h2>

			{#if form?.action === 'saveNotes' && form?.success}
				<p
					role="status"
					class="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800"
				>
					{form.success}
				</p>
			{/if}
			{#if form?.action === 'saveNotes' && form?.error}
				<p
					role="alert"
					class="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
				>
					{form.error}
				</p>
			{/if}

			<form
				method="POST"
				action="?/saveNotes"
				use:enhance={() =>
					async ({ update }) => {
						await update({ reset: false });
					}}
			>
				<input type="hidden" name="csrf" value={page.data.csrfToken} />
				<textarea
					name="notes"
					rows="6"
					bind:value={notesValue}
					class="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
				></textarea>
				<div class="mt-2 flex items-center gap-3">
					<Button type="submit" variant="default" size="sm">Save</Button>
					{#if notesDirty}
						<span class="text-xs text-amber-600">Unsaved changes</span>
					{/if}
				</div>
			</form>
		</section>
	{:else}
		<section class="space-y-3 rounded border border-gray-200 bg-gray-50 px-5 py-4">
			<h2 class="text-base font-semibold">Notes about submission</h2>
			<textarea
				readonly
				rows="6"
				value={data.submission.levelOfNeedSummary ?? ''}
				class="w-full rounded border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-600"
			></textarea>
		</section>
	{/if}

	<SubmissionView data={data.submission} attachments={data.attachments} />
	<AttachmentsView attachments={data.attachments} />
	<MetadataView metadata={data.metadata} />
</div>

<svelte:window
	onbeforeunload={(e) => {
		if (notesDirty) {
			e.preventDefault();
		}
	}}
/>
