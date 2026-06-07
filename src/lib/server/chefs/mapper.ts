import { submissionSchema, type SubmissionInput } from '$lib/form/schema';
import type { ChefsConfig, ChefsFileRef, ChefsSubmissionRaw } from './types';

export interface MapResult {
	submissionUuid: string;
	payload: SubmissionInput;
	rawPayloadJson: string;
	attachments: ChefsFileRef[];
	validationErrors: unknown[] | null;
}

function pickSubmissionUuid(raw: ChefsSubmissionRaw): string {
	const id = raw.form?.submissionId ?? raw.form?.confirmationId;
	if (!id || typeof id !== 'string') {
		throw new Error('CHEFS submission missing form.submissionId and form.confirmationId');
	}
	return `chefs_${id}`;
}

function pushFiles(arr: unknown, out: ChefsFileRef[], assessmentIndex?: number) {
	if (!Array.isArray(arr)) return;
	for (const item of arr as Array<{ data?: { id?: string }; originalName?: string }>) {
		const id = item?.data?.id,
			name = item?.originalName;
		if (typeof id === 'string' && typeof name === 'string')
			out.push(
				assessmentIndex === undefined
					? { fileId: id, originalName: name }
					: { fileId: id, originalName: name, assessmentIndex }
			);
	}
}

function extractAttachments(raw: ChefsSubmissionRaw, cfg: ChefsConfig): ChefsFileRef[] {
	const out: ChefsFileRef[] = [];
	// editGrid-nested files (one component per row)
	const grid = raw['editGrid'];
	if (Array.isArray(grid)) {
		grid.forEach((row, i) => {
			for (const key of cfg.fileComponents)
				pushFiles((row as Record<string, unknown>)?.[key], out, i);
		});
	}
	// top-level file components (fallback for non-grid forms)
	for (const key of cfg.fileComponents) pushFiles(raw[key], out);
	return out;
}

export function mapChefsSubmission(raw: ChefsSubmissionRaw, cfg: ChefsConfig): MapResult {
	const submissionUuid = pickSubmissionUuid(raw);

	const stripped: Record<string, unknown> = { ...raw };
	delete stripped.form;
	for (const fc of cfg.fileComponents) delete stripped[fc];

	const rawPayloadJson = JSON.stringify(raw);
	const result = submissionSchema.safeParse(stripped);
	if (!result.success) {
		return {
			submissionUuid,
			payload: stripped as SubmissionInput,
			rawPayloadJson,
			attachments: extractAttachments(raw, cfg),
			validationErrors: result.error.issues
		};
	}
	return {
		submissionUuid,
		payload: result.data,
		rawPayloadJson,
		attachments: extractAttachments(raw, cfg),
		validationErrors: null
	};
}
