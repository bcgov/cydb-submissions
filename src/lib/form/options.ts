import schemaJson from './cydb_form_schema.json' with { type: 'json' };

export interface Option {
	value: string;
	label: string;
}
type Opt = { value?: unknown; label?: string };
type JsonItem = { name?: string; professionals?: Array<{ name?: string }> };
type ColumnDef = { components?: FormioComponent[] };
type FormioComponent = {
	key?: string;
	type?: string;
	components?: FormioComponent[];
	columns?: ColumnDef[];
	values?: Opt[];
	data?: { values?: Opt[]; json?: JsonItem[] | string };
	template?: string;
};

const LAYOUT = new Set([
	'panel',
	'simplepanel',
	'columns',
	'simplecols2',
	'simplecols3',
	'simplecontent',
	'content',
	'button',
	'editgrid'
]);

// AssessmentType-style components carry options under data.json as {name, professionals[]}.
const professionalsByType: Record<string, string[]> = {};

function optionsFrom(c: FormioComponent): Option[] | undefined {
	const v = c.values ?? c.data?.values;
	if (Array.isArray(v) && v.length && !(v.length === 1 && v[0].value === '')) {
		return v.map((o) => ({ value: String(o.value), label: o.label ?? String(o.value) }));
	}
	const json = c.data?.json;
	if (Array.isArray(json) && json.length) {
		const out: Option[] = [];
		for (const item of json) {
			if (!item?.name) continue;
			out.push({ value: item.name, label: item.name });
			professionalsByType[item.name] = (item.professionals ?? [])
				.map((p) => p.name)
				.filter((n): n is string => Boolean(n));
		}
		return out;
	}
	return undefined;
}

function walk(
	c: FormioComponent,
	path: string[],
	acc: { paths: string[]; opts: Record<string, Option[]> }
) {
	const isLayout = !c.type || !c.key || LAYOUT.has(c.type);
	// Layout components do NOT contribute their key to the path so that leaf fields
	// are stored under their own bare key (or dotted sub-path if they are nested
	// inside a non-layout parent in the future).
	const here = c.key && !isLayout ? [...path, c.key] : path;
	if (!isLayout) {
		acc.paths.push(here.join('.'));
		const o = optionsFrom(c);
		if (o) acc.opts[c.key!] = o;
	}
	// Recurse into standard components array
	for (const child of c.components ?? []) walk(child, here, acc);
	// Recurse into columns[].components (used by simplecols2, simplecols3, columns types)
	for (const col of c.columns ?? []) {
		for (const child of col.components ?? []) walk(child, here, acc);
	}
}

function build() {
	const root = schemaJson as unknown as FormioComponent;
	const acc = { paths: [] as string[], opts: {} as Record<string, Option[]> };
	for (const c of root.components ?? []) walk(c, [], acc);
	return acc;
}

const built = build();

export const FIELDS: ReadonlyArray<string> = Object.freeze(built.paths);
export const OPTIONS: Readonly<Record<string, ReadonlyArray<Option>>> = Object.freeze(built.opts);
export const ASSESSMENT_TYPE_PROFESSIONALS: Readonly<Record<string, ReadonlyArray<string>>> =
	Object.freeze(professionalsByType);
