/**
 * Format a date for display using the same shape as JavaScript's
 * `Date.prototype.toDateString()` — e.g. "Mon Apr 02 2026" (no time component).
 *
 * Bare calendar dates (`yyyy-mm-dd`, e.g. a date of birth) are interpreted in
 * the local timezone so they don't drift a day under UTC parsing; full
 * timestamps are parsed as-is.
 */
export function formatDate(value: string | null | undefined): string {
	if (!value) return '—';
	const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? String(value) : d.toDateString();
}
