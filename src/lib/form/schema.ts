import { z } from 'zod';
import { OPTIONS, ASSESSMENT_TYPE_PROFESSIONALS } from './options';

const values = (key: string) => OPTIONS[key].map((o) => o.value) as [string, ...string[]];

// ---- Form.io shape normalizers -------------------------------------------
// selectboxes submit as { [optionValue]: boolean }. One-box attestation → boolean.
const checkedKeys = (v: unknown): string[] =>
	v && typeof v === 'object' && !Array.isArray(v)
		? Object.entries(v as Record<string, unknown>)
				.filter(([, on]) => on === true)
				.map(([k]) => k)
		: Array.isArray(v)
			? (v as string[])
			: [];
const attested = (v: unknown): boolean => checkedKeys(v).length > 0;
// select with data.json stores the selected object; accept object|string.
const itemName = (v: unknown): string => {
	if (typeof v === 'string') return v;
	if (v && typeof v === 'object' && 'name' in v) {
		const n = (v as Record<string, unknown>).name;
		return typeof n === 'string' && n.length > 0 ? n : '';
	}
	return '';
};

const isoDate = (label: string) =>
	z
		.string()
		.refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')), {
			message: `${label} must be ISO yyyy-mm-dd`
		});
const notFuture = (s: string) => Date.parse(s + 'T00:00:00Z') <= Date.now();
const yearsBetween = (dob: string, asOf: string) => {
	const a = new Date(asOf + 'T00:00:00Z'),
		b = new Date(dob + 'T00:00:00Z');
	let age = a.getUTCFullYear() - b.getUTCFullYear();
	const m = a.getUTCMonth() - b.getUTCMonth();
	if (m < 0 || (m === 0 && a.getUTCDate() < b.getUTCDate())) age--;
	return age;
};

const CHILD_DOB_FLOOR = '2008-03-31';
const SIGNATORY_MIN_AGE_YEARS = 19;

const assessmentRow = z
	.object({
		AssessmentType: z.unknown(),
		completedBy: z.unknown(),
		dateOfAssessment: isoDate('date of assessment'),
		AttachAssessment: z.array(z.unknown()).optional()
	})
	.transform((row) => ({
		assessmentType: itemName(row.AssessmentType),
		completedBy: itemName(row.completedBy),
		dateOfAssessment: row.dateOfAssessment,
		attachmentName: String((row.AttachAssessment?.[0] as any)?.originalName ?? ''),
		_hasFile: (row.AttachAssessment?.length ?? 0) > 0
	}));

export const submissionSchema = z
	.object({
		childYouthsFirstName: z.string().min(1),
		childYouthsMiddleNameS: z.string().optional().default(''),
		childYouthsLegalLastName: z.string().min(1),
		childYouthsDateOfBirth: isoDate('child date of birth'),
		childYouthsGender: z.enum(values('childYouthsGender')),
		agreementSignatorysLegalFirstName: z.string().min(1),
		agreementSignatorysLegalLastName: z.string().min(1),
		childYouthsDateOfBirth1: isoDate('signatory date of birth'),
		AgreementSigGender: z.enum(values('AgreementSigGender')),
		AgreementSigRelationship: z.string().min(1),
		primaryPhoneNumber: z.string().min(1),
		email: z.string().email(),
		screening: z.enum(['Yes', 'No']),
		simplecheckboxes: z
			.preprocess(checkedKeys, z.array(z.enum(values('simplecheckboxes'))))
			.optional(),
		editGrid: z.array(assessmentRow).optional().default([]),
		PrimaryCareAndControl: z.preprocess(attested, z.boolean()),
		iAmTheAgreementSignatory: z.preprocess(attested, z.boolean()).optional(),
		iAmTheAgreementSignatory1: z.preprocess(attested, z.boolean()).optional(),
		iAmTheAgreementSignatory2: z.preprocess(attested, z.boolean()).optional(),
		signature: z
			.string()
			.min(1)
			.refine((s) => s.startsWith('data:image/'), {
				message: 'signature must be an image data URL'
			}),
		dateSigned: isoDate('date signed'),
		browserFingerprint: z.string().max(256).optional(),
		csrfTokenEcho: z.string().max(256).optional()
	})
	.superRefine((v, ctx) => {
		// Date / age rules
		if (!notFuture(v.childYouthsDateOfBirth) || v.childYouthsDateOfBirth < CHILD_DOB_FLOOR)
			ctx.addIssue({
				code: 'custom',
				path: ['childYouthsDateOfBirth'],
				message: `child date of birth must be between ${CHILD_DOB_FLOOR} and today`
			});
		if (!notFuture(v.childYouthsDateOfBirth1))
			ctx.addIssue({
				code: 'custom',
				path: ['childYouthsDateOfBirth1'],
				message: 'signatory date of birth cannot be in the future'
			});
		else if (
			notFuture(v.dateSigned) &&
			yearsBetween(v.childYouthsDateOfBirth1, v.dateSigned) < SIGNATORY_MIN_AGE_YEARS
		)
			ctx.addIssue({
				code: 'custom',
				path: ['childYouthsDateOfBirth1'],
				message: `signatory must be at least ${SIGNATORY_MIN_AGE_YEARS} years old`
			});
		if (!notFuture(v.dateSigned))
			ctx.addIssue({
				code: 'custom',
				path: ['dateSigned'],
				message: 'date signed cannot be in the future'
			});
		// PrimaryCareAndControl gates the signature in the form; require it true.
		if (v.PrimaryCareAndControl !== true)
			ctx.addIssue({
				code: 'custom',
				path: ['PrimaryCareAndControl'],
				message: 'primary care and control attestation is required'
			});

		if (v.screening === 'Yes') {
			if (!v.editGrid || v.editGrid.length < 1)
				ctx.addIssue({
					code: 'custom',
					path: ['editGrid'],
					message: 'at least one assessment is required'
				});
			v.editGrid?.forEach((row, i) => {
				if (!row.assessmentType)
					ctx.addIssue({
						code: 'custom',
						path: ['editGrid', i, 'AssessmentType'],
						message: 'required'
					});
				if (!row.completedBy)
					ctx.addIssue({
						code: 'custom',
						path: ['editGrid', i, 'completedBy'],
						message: 'required'
					});
				if (!row._hasFile)
					ctx.addIssue({
						code: 'custom',
						path: ['editGrid', i, 'AttachAssessment'],
						message: 'an attachment is required'
					});
				if (row.dateOfAssessment && !notFuture(row.dateOfAssessment))
					ctx.addIssue({
						code: 'custom',
						path: ['editGrid', i, 'dateOfAssessment'],
						message: 'date of assessment cannot be in the future'
					});
				const allowed = ASSESSMENT_TYPE_PROFESSIONALS[row.assessmentType];
				if (allowed && row.completedBy && !allowed.includes(row.completedBy))
					ctx.addIssue({
						code: 'custom',
						path: ['editGrid', i, 'completedBy'],
						message: `not valid for ${row.assessmentType}`
					});
			});
			if (v.iAmTheAgreementSignatory !== true)
				ctx.addIssue({
					code: 'custom',
					path: ['iAmTheAgreementSignatory'],
					message: 'consent to collection is required'
				});
			if (v.iAmTheAgreementSignatory1 !== true)
				ctx.addIssue({
					code: 'custom',
					path: ['iAmTheAgreementSignatory1'],
					message: 'consent to disclosure is required'
				});
		} else {
			if (!v.simplecheckboxes || v.simplecheckboxes.length < 1)
				ctx.addIssue({
					code: 'custom',
					path: ['simplecheckboxes'],
					message: 'select at least one reason'
				});
			if (v.iAmTheAgreementSignatory2 !== true)
				ctx.addIssue({
					code: 'custom',
					path: ['iAmTheAgreementSignatory2'],
					message: 'confirmation is required'
				});
		}
	})
	// Drop the internal _hasFile flag from the output.
	.transform((v) => ({ ...v, editGrid: v.editGrid?.map(({ _hasFile, ...row }) => row) }));

export type SubmissionInput = z.infer<typeof submissionSchema>;
