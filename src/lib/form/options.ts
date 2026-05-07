import schemaJson from '../../../../cydb_form_schema.json' with { type: 'json' };

export interface Option { value: string; label: string; }
type FormioComponent = {
  key?: string;
  type?: string;
  components?: FormioComponent[];
  values?: Array<{ value: unknown; label: string }>;
  data?: { values?: Array<{ value: unknown; label: string }> };
  defaultValue?: unknown;
};

function walkComponents(c: FormioComponent, path: string[], out: { paths: string[]; opts: Record<string, Option[]> }) {
  const here = c.key ? [...path, c.key] : path;
  if (c.type && c.key && c.type !== 'panel' && c.type !== 'simplecontent' && c.type !== 'button') {
    out.paths.push(here.join('.'));
    const v = c.values ?? c.data?.values;
    if (v && Array.isArray(v)) {
      // Coerce values to strings so option lists are uniform regardless of
      // whether the schema author wrote `true`, `0`, or `"English"`.
      out.opts[c.key] = v.map((o) => ({ value: String(o.value), label: o.label }));
    }
  }
  for (const child of c.components ?? []) walkComponents(child, here, out);
}

function build() {
  const root = schemaJson as unknown as FormioComponent;
  const acc = { paths: [] as string[], opts: {} as Record<string, Option[]> };
  for (const c of root.components ?? []) walkComponents(c, [], acc);
  return acc;
}

const built = build();

export const FIELDS: ReadonlyArray<string> = Object.freeze(built.paths);
export const OPTIONS: Readonly<Record<string, ReadonlyArray<Option>>> = Object.freeze(built.opts);
