import { SUBMISSION_STATUSES, type SubmissionStatus } from './db/schema';

export const SORT_COLUMNS = ['date', 'surname', 'status', 'attachments'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export type SortOrder = 'asc' | 'desc';
export type StatusFilter = 'all' | 'exclude_invalid' | SubmissionStatus;

const STATUS_FILTER_VALUES = new Set<string>([
	'all',
	'exclude_invalid',
	...SUBMISSION_STATUSES
]);

export interface SubmissionsQuery {
	sort: SortColumn;
	order: SortOrder;
	page: number;
	size: number;
	statusFilter: StatusFilter;
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
	return { sort, order, page, size, statusFilter };
}

function toInt(s: string | null, fallback: number): number {
	if (!s) return fallback;
	const n = Number.parseInt(s, 10);
	return Number.isNaN(n) ? fallback : n;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}
