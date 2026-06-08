<script lang="ts">
	import type { SubmissionRow, AttachmentWithOcr } from '$lib/types';
	import { lookupLabel } from './labels';
	import { formatDate } from '$lib/format-date';
	import { Badge } from '$lib/components/ui/badge';
	import PhoneIcon from '@lucide/svelte/icons/phone';
	import MailIcon from '@lucide/svelte/icons/mail';
	import CheckIcon from '@lucide/svelte/icons/check';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import PaperclipIcon from '@lucide/svelte/icons/paperclip';

	let { data, attachments = [] }: { data: SubmissionRow; attachments?: AttachmentWithOcr[] } =
		$props();

	// Map each assessment (editGrid row) to its uploaded file via assessment_index.
	const attachmentForIndex = (i: number) => attachments.find((a) => a.assessmentIndex === i);

	const childName = $derived(
		[data.childYouthFirstName, data.childYouthMiddleNames, data.childYouthLastName]
			.filter(Boolean)
			.join(' ')
	);

	const assessments = $derived(
		(data.assessments ?? []) as Array<{
			assessmentType: string;
			completedBy: string;
			dateOfAssessment: string;
			attachmentName: string;
		}>
	);

	const notSubmittingReasons = $derived((data.notSubmittingReasons ?? []) as string[]);
</script>

{#snippet eyebrow(text: string)}
	<p class="text-xs font-medium tracking-wide text-gray-500 uppercase">{text}</p>
{/snippet}

{#snippet attest(checked: boolean | null | undefined, label: string)}
	<li class="flex items-start gap-2.5">
		{#if checked}
			<CheckIcon class="mt-0.5 size-4 shrink-0 text-green-600" />
			<span class="text-gray-700">{label}</span>
		{:else}
			<MinusIcon class="mt-0.5 size-4 shrink-0 text-gray-300" />
			<span class="text-gray-400">{label}</span>
		{/if}
	</li>
{/snippet}

<div class="space-y-10">
	<!-- Child / youth — led by the name; DOB + gender as a quiet meta line -->
	<header class="space-y-1.5">
		{@render eyebrow('Child / youth')}
		<h2 class="text-2xl font-semibold tracking-tight text-gray-900">{childName}</h2>
		<p class="text-sm text-gray-500">
			Born {formatDate(data.childYouthDob)} · {lookupLabel(
				'childYouthsGender',
				data.childYouthGender
			)}
		</p>
	</header>

	<!-- Agreement signatory -->
	<section class="space-y-2">
		{@render eyebrow('Agreement signatory')}
		<p class="text-base text-gray-900">
			<span class="font-medium">{data.signatoryFirstName} {data.signatoryLastName}</span>
			<span class="text-gray-500"> · {data.signatoryRelationship}</span>
		</p>
		<p class="text-sm text-gray-500">
			Born {formatDate(data.signatoryDob)} · {lookupLabel(
				'AgreementSigGender',
				data.signatoryGender
			)}
		</p>
		<div class="flex flex-wrap gap-x-6 gap-y-1 pt-1 text-sm text-gray-600">
			<span class="inline-flex items-center gap-1.5">
				<PhoneIcon class="size-3.5 text-gray-400" />{data.primaryPhone}
			</span>
			<a href="mailto:{data.email}" class="inline-flex items-center gap-1.5 hover:text-blue-700">
				<MailIcon class="size-3.5 text-gray-400" />{data.email}
			</a>
		</div>
	</section>

	<!-- Assessment information (screening + branch) -->
	<section class="space-y-4">
		<div class="flex items-center gap-3">
			{@render eyebrow('Assessment information')}
			{#if data.screening === 'Yes'}
				<Badge variant="outline" class="border-green-200 bg-green-50 text-green-800"
					>Submitting</Badge
				>
			{:else}
				<Badge variant="outline" class="border-gray-200 bg-gray-50 text-gray-600"
					>Not submitting</Badge
				>
			{/if}
		</div>

		{#if data.screening === 'Yes'}
			<!-- Assessments as self-describing cards (type is the heading; no field labels needed) -->
			{#if assessments.length === 0}
				<p class="text-sm text-gray-500">No assessments recorded.</p>
			{:else}
				<div class="space-y-3">
					{#each assessments as a, i (i)}
						{@const att = attachmentForIndex(i)}
						<div class="rounded-lg border border-gray-200 p-4">
							<p class="font-medium text-gray-900">
								{lookupLabel('AssessmentType', a.assessmentType)}
							</p>
							<p class="mt-0.5 text-sm text-gray-500">
								Completed by {a.completedBy} · {formatDate(a.dateOfAssessment)}
							</p>
							{#if att}
								<a
									class="mt-2.5 inline-flex items-center gap-1.5 text-sm text-blue-700 hover:underline"
									href="/attachments/{att.id}?download=1"
								>
									<PaperclipIcon class="size-3.5" />{att.originalFilename}
								</a>
							{:else if a.attachmentName}
								<p class="mt-2.5 inline-flex items-center gap-1.5 text-sm text-gray-500">
									<PaperclipIcon class="size-3.5" />{a.attachmentName}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<ul class="space-y-1.5 text-sm">
				{@render attest(data.consentCollection, 'Consent to the collection of information')}
				{@render attest(
					data.consentDisclosure,
					'Consent to the disclosure of personal information'
				)}
			</ul>
		{:else if data.screening === 'No'}
			{#if notSubmittingReasons.length > 0}
				<div class="space-y-1.5">
					<p class="text-sm text-gray-500">Reasons given</p>
					<ul class="list-disc space-y-1 pl-5 text-sm text-gray-700">
						{#each notSubmittingReasons as reason (reason)}
							<li>{lookupLabel('simplecheckboxes', reason)}</li>
						{/each}
					</ul>
				</div>
			{/if}
			<ul class="space-y-1.5 text-sm">
				{@render attest(
					data.confirmNotSubmitting,
					'Confirmed not submitting assessment information at this time'
				)}
			</ul>
		{/if}
	</section>

	<!-- Declaration -->
	<section class="space-y-3">
		{@render eyebrow('Declaration')}
		<ul class="space-y-1.5 text-sm">
			{@render attest(
				data.primaryCareAndControl,
				'Agreement signatory with primary care and control, or legal guardian'
			)}
		</ul>
		{#if data.signature}
			<div class="inline-block rounded-lg border border-gray-200 bg-white p-3">
				<img src={data.signature} alt="Applicant signature" class="max-h-20" />
			</div>
		{/if}
		<p class="text-sm text-gray-500">Signed {formatDate(data.dateSigned)}</p>
	</section>
</div>
