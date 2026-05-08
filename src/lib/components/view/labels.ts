import { OPTIONS } from '$lib/form/options';

export function lookupLabel(key: string, value: string | number | null | undefined): string {
	if (value === null || value === undefined || value === '') return '—';
	const opts = OPTIONS[key];
	if (!opts) return String(value);
	return opts.find((o) => o.value === String(value))?.label ?? String(value);
}

export function yesNo(v: boolean | number | null | undefined): string {
	if (v === null || v === undefined) return '—';
	return v ? 'Yes' : 'No';
}
