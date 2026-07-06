import { SUBMISSION_STATUSES, type SubmissionStatus } from './db/schema';

export const SORT_COLUMNS = [
	'date',
	'surname',
	'child_first_name',
	'child_last_name',
	'screening',
	'assessments',
	'status',
	'attachments',
	'category1',
	'category2',
	'category3',
	'category4',
	'category5',
	'category6',
	'category7',
	'category8',
	'category9',
	'category10',
	'category11',
	'category12',
	'category13',
	'total'
] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortOrder = 'asc' | 'desc';
export type StatusFilter = 'all' | 'exclude_invalid' | 'ocr_processed' | 'ready_for_review' | 'ready_for_clinician' | 'ready_for_policy' | 'provisionally_eligible' | SubmissionStatus;

const STATUS_FILTER_VALUES = new Set<string>([
	'all',
	'exclude_invalid',
	'ocr_processed',
	'ready_for_review',
	'ready_for_clinician',
	'ready_for_policy',
	'provisionally_eligible',
	...SUBMISSION_STATUSES
]);

export interface SubmissionsQuery {
	sort: SortColumn;
	order: SortOrder;
	page: number;
	size: number;
	statusFilter: StatusFilter;
	q: string;
}

export function parseSubmissionsQuery(url: URL): SubmissionsQuery {
	const sortRaw = url.searchParams.get('sort');
	const sort: SortColumn = (SORT_COLUMNS as readonly string[]).includes(sortRaw ?? '')
		? (sortRaw as SortColumn)
		: 'date';
	const order: SortOrder = url.searchParams.get('order') === 'asc' ? 'asc' : 'desc';
	const page = clamp(toInt(url.searchParams.get('page'), 1), 1, 1_000_000);
	const size = clamp(toInt(url.searchParams.get('size'), 25), 10, 100);
	const filterRaw = url.searchParams.get('status');
	const statusFilter: StatusFilter = STATUS_FILTER_VALUES.has(filterRaw ?? '')
		? (filterRaw as StatusFilter)
		: 'exclude_invalid';
	const q = (url.searchParams.get('q') ?? '').trim();
	return { sort, order, page, size, statusFilter, q };
}

function toInt(s: string | null, fallback: number): number {
	if (!s) return fallback;
	const n = Number.parseInt(s, 10);
	return Number.isNaN(n) ? fallback : n;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}
