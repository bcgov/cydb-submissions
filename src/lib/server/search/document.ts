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
	dateOfBirth?: string | null;
	primaryLanguage?: string | null;
	developmentalConcerns?: boolean | null;
	ageOfFirstConcern?: string | null;
	hasFormalDiagnosis?: boolean | null;
	diagnosticStatus?: string | null;
	assessmentTools?: string[] | null;
	communication?: string | null;
	socialInteraction?: string | null;
	dailyLivingSkills?: string | null;
	behaviouralConcerns?: string | null;
	conditions?: string[] | null;
	services?: string[] | null;
	weeklyHours?: number | null;
	createdAt: string;
}

function yesNo(v: boolean | null | undefined): string {
	if (v === true) return 'yes';
	if (v === false) return 'no';
	return '';
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
		row.submitterSurname ?? '',
		`date of birth: ${row.dateOfBirth ?? ''}`,
		`primary language: ${labelFor('primaryLanguage', row.primaryLanguage ?? '')}`,
		`developmental concerns: ${yesNo(row.developmentalConcerns)}`,
		`age of first concern: ${row.ageOfFirstConcern ?? ''}`,
		`formal diagnosis: ${yesNo(row.hasFormalDiagnosis)}`,
		`diagnostic status: ${labelFor('diagnosticStatus', row.diagnosticStatus ?? '')}`,
		`assessment tools: ${labelsFor('assessmentTools', row.assessmentTools).join(', ')}`,
		`communication: ${labelFor('communication', row.communication ?? '')}`,
		`social interaction: ${labelFor('socialInteraction', row.socialInteraction ?? '')}`,
		`daily living skills: ${labelFor('dailyLivingSkills', row.dailyLivingSkills ?? '')}`,
		`behavioural concerns: ${labelFor('behaviouralConcerns', row.behaviouralConcerns ?? '')}`,
		`co-occurring conditions: ${labelsFor('conditions', row.conditions).join(', ')}`,
		`current services: ${labelsFor('services', row.services).join(', ')}`,
		`weekly hours: ${row.weeklyHours ?? ''}`,
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
