<script lang="ts">
	import type { SubmissionRow, SubmissionAttachmentRow } from '$lib/types';
	import { lookupLabel, yesNo } from './labels';

	let { data, attachments = [] }: { data: SubmissionRow; attachments?: SubmissionAttachmentRow[] } =
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

<div class="space-y-8">
	<!-- Child / Youth -->
	<section>
		<h2 class="mb-2 text-lg font-semibold">Child / Youth</h2>
		<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
			<dt class="font-medium">Full name</dt>
			<dd>{childName}</dd>
			<dt class="font-medium">Date of birth</dt>
			<dd>{data.childYouthDob}</dd>
			<dt class="font-medium">Gender</dt>
			<dd>{lookupLabel('childYouthsGender', data.childYouthGender)}</dd>
		</dl>
	</section>

	<!-- Agreement Signatory -->
	<section>
		<h2 class="mb-2 text-lg font-semibold">Agreement Signatory</h2>
		<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
			<dt class="font-medium">Name</dt>
			<dd>{data.signatoryFirstName} {data.signatoryLastName}</dd>
			<dt class="font-medium">Date of birth</dt>
			<dd>{data.signatoryDob}</dd>
			<dt class="font-medium">Gender</dt>
			<dd>{lookupLabel('AgreementSigGender', data.signatoryGender)}</dd>
			<dt class="font-medium">Relationship to child/youth</dt>
			<dd>{data.signatoryRelationship}</dd>
			<dt class="font-medium">Phone</dt>
			<dd>{data.primaryPhone}</dd>
			<dt class="font-medium">Email</dt>
			<dd>{data.email}</dd>
		</dl>
	</section>

	<!-- Screening -->
	<section>
		<h2 class="mb-2 text-lg font-semibold">Screening</h2>
		<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
			<dt class="font-medium">Submitting assessment</dt>
			<dd>{data.screening}</dd>
		</dl>
	</section>

	{#if data.screening === 'Yes'}
		<!-- Assessments -->
		<section>
			<h2 class="mb-2 text-lg font-semibold">Assessments</h2>
			{#if assessments.length === 0}
				<p class="text-sm text-gray-600">No assessments recorded.</p>
			{:else}
				<table class="w-full border-collapse text-sm">
					<thead>
						<tr class="border-b text-left">
							<th class="py-1 pr-4 font-medium">Type</th>
							<th class="py-1 pr-4 font-medium">Completed by</th>
							<th class="py-1 pr-4 font-medium">Date</th>
							<th class="py-1 font-medium">Attachment</th>
						</tr>
					</thead>
					<tbody>
						{#each assessments as assessment, i (i)}
							<tr class="border-b last:border-0">
								<td class="py-1 pr-4">{lookupLabel('AssessmentType', assessment.assessmentType)}</td
								>
								<td class="py-1 pr-4">{assessment.completedBy}</td>
								<td class="py-1 pr-4">{assessment.dateOfAssessment}</td>
								<td class="py-1">
									{#if attachmentForIndex(i)}
										<a
											class="text-blue-700 underline"
											href="/attachments/{attachmentForIndex(i)!.id}?download=1"
										>
											{attachmentForIndex(i)!.originalFilename}
										</a>
									{:else if assessment.attachmentName}
										{assessment.attachmentName}
									{:else}
										—
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
			<dl class="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
				<dt class="font-medium">Consent — collection</dt>
				<dd>{yesNo(data.consentCollection)}</dd>
				<dt class="font-medium">Consent — disclosure</dt>
				<dd>{yesNo(data.consentDisclosure)}</dd>
			</dl>
		</section>
	{:else if data.screening === 'No'}
		<!-- Not submitting reasons -->
		<section>
			<h2 class="mb-2 text-lg font-semibold">Reasons for not submitting</h2>
			{#if notSubmittingReasons.length === 0}
				<p class="text-sm text-gray-600">No reasons recorded.</p>
			{:else}
				<ul class="list-disc space-y-1 pl-5 text-sm">
					{#each notSubmittingReasons as reason (reason)}
						<li>{lookupLabel('simplecheckboxes', reason)}</li>
					{/each}
				</ul>
			{/if}
			<dl class="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
				<dt class="font-medium">Confirmed not submitting</dt>
				<dd>{yesNo(data.confirmNotSubmitting)}</dd>
			</dl>
		</section>
	{/if}

	<!-- Signature -->
	<section>
		<h2 class="mb-2 text-lg font-semibold">Signature</h2>
		<dl class="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
			{#if data.signature}
				<dt class="font-medium">Signature</dt>
				<dd>
					<img
						src={data.signature}
						alt="Applicant signature"
						class="max-h-24 rounded border border-gray-200 bg-white"
					/>
				</dd>
			{/if}
			<dt class="font-medium">Date signed</dt>
			<dd>{data.dateSigned}</dd>
			<dt class="font-medium">Primary care and control</dt>
			<dd>{yesNo(data.primaryCareAndControl)}</dd>
		</dl>
	</section>
</div>
