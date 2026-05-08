<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { OPTIONS } from '$lib/form/options';
  import type { FormState } from '$lib/form/store.svelte';

  let { form }: { form: FormState } = $props();

  let weeklyHours = $state<string>(
    form.get('currentSupports.weeklyHours') == null ? '' : String(form.get('currentSupports.weeklyHours'))
  );
  $effect(() => {
    weeklyHours = form.get('currentSupports.weeklyHours') == null
      ? ''
      : String(form.get('currentSupports.weeklyHours'));
  });

  function toggle(value: string, checked: boolean) {
    const cur = (form.get('currentSupports.services') as string[]) ?? [];
    form.set('currentSupports.services',
      checked ? Array.from(new Set([...cur, value])) : cur.filter((v) => v !== value));
  }

  function onHoursInput(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value;
    weeklyHours = raw;
    form.set('currentSupports.weeklyHours', raw === '' ? undefined : Number(raw));
  }
</script>

<section class="space-y-4 mb-8" aria-labelledby="cs-h">
  <h2 id="cs-h" class="text-lg font-semibold">Current supports</h2>
  <fieldset class="space-y-2">
    <legend class="text-sm">Which services is your child currently receiving?</legend>
    {#each OPTIONS.services as o (o.value)}
      {@const checked = ((form.get('currentSupports.services') as string[]) ?? []).includes(o.value)}
      <div class="flex items-center gap-2">
        <Checkbox id={'s-' + o.value} {checked} onCheckedChange={(v) => toggle(o.value, !!v)} />
        <Label for={'s-' + o.value}>{o.label}</Label>
      </div>
    {/each}
  </fieldset>

  <div class="space-y-1">
    <Label for="weeklyHours">Approximate hours of autism-related services per week</Label>
    <Input
      id="weeklyHours"
      type="number"
      min="0"
      max="168"
      step="0.5"
      value={weeklyHours}
      oninput={onHoursInput}
    />
  </div>
</section>
