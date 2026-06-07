import { OPTIONS } from '$lib/form/options';
import type { SearchDocument } from './types';

/** Map a single coded value to its human label, falling back to the raw value. */
export function labelFor(key: string, value: string): string {
	const opts = OPTIONS[key];
	if (!opts) return value;
	const hit = opts.find((o) => o.value === value);
	return hit ? hit.label : value;
}

export function labelsFor(key: string, values: string[] | null | undefined): string[] {
	if (!values) return [];
	return values.map((v) => labelFor(key, String(v)));
}

/** Shape of the columns this builder reads (subset of the submissions row). */
export interface SubmissionRowForIndex {
	id: number;
	submissionUuid: string;
	status: string;
	submitterSurname: string | null;
	childYouthFirstName: string;
	childYouthMiddleNames?: string | null;
	childYouthLastName: string;
	childYouthDob: string;
	childYouthGender: string;
	signatoryFirstName: string;
	signatoryLastName: string;
	signatoryDob: string;
	signatoryGender?: string | null;
	signatoryRelationship?: string | null;
	primaryPhone?: string | null;
	email?: string | null;
	screening: string;
	notSubmittingReasons?: string[] | null;
	assessments?: Array<{
		assessmentType: string;
		completedBy: string;
		dateOfAssessment: string;
		attachmentName: string;
	}> | null;
	createdAt: string;
}

/**
 * Convert a stored timestamp to unix seconds. SQLite CURRENT_TIMESTAMP is the
 * space-separated 'YYYY-MM-DD HH:MM:SS' in UTC; some rows already store ISO-8601
 * (with or without a trailing 'Z'). Normalise all three to a parseable UTC
 * instant; return 0 if unparseable.
 */
export function toUnixSeconds(ts: string): number {
	let iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
	// Append 'Z' only when there is no timezone designator already.
	if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(iso)) iso = `${iso}Z`;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000);
}

export function buildSearchDocument(
	row: SubmissionRowForIndex,
	ocrText: string,
	metadataText: string
): SearchDocument {
	const parts: string[] = [
		`${row.childYouthFirstName ?? ''} ${row.childYouthLastName ?? ''}`.trim(),
		`signatory: ${row.signatoryFirstName ?? ''} ${row.signatoryLastName ?? ''}`.trim(),
		`child date of birth: ${row.childYouthDob ?? ''}`,
		`gender: ${labelFor('childYouthsGender', row.childYouthGender ?? '')}`,
		`screening: ${row.screening ?? ''}`,
		...(row.assessments ?? []).flatMap((a) => [
			`assessment: ${a.assessmentType}`,
			`completed by: ${a.completedBy}`,
			`assessment date: ${a.dateOfAssessment}`
		]),
		...labelsFor('simplecheckboxes', row.notSubmittingReasons).map((r) => `reason: ${r}`),
		`status: ${row.status}`
	];

	return {
		id: row.id,
		submissionUuid: row.submissionUuid,
		status: row.status,
		createdAt: toUnixSeconds(row.createdAt),
		surname: row.submitterSurname ?? '',
		structuredText: parts.filter(Boolean).join(' \n '),
		ocrText,
		metadataText
	};
}
