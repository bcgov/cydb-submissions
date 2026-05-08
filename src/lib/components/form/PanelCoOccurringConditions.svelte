<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { OPTIONS } from '$lib/form/options';
  import type { FormState } from '$lib/form/store.svelte';

  let { form }: { form: FormState } = $props();

  function toggle(value: string, checked: boolean) {
    const cur = (form.get('coOccurringConditions.conditions') as string[]) ?? [];
    form.set('coOccurringConditions.conditions',
      checked ? Array.from(new Set([...cur, value])) : cur.filter((v) => v !== value));
  }
</script>

<section class="space-y-4 mb-8" aria-labelledby="cooc-h">
  <h2 id="cooc-h" class="text-lg font-semibold">Co-occurring conditions</h2>
  <fieldset class="space-y-2">
    <legend class="text-sm">Has your child been diagnosed with any of the following?</legend>
    {#each OPTIONS.conditions as o (o.value)}
      {@const checked = ((form.get('coOccurringConditions.conditions') as string[]) ?? []).includes(o.value)}
      <div class="flex items-center gap-2">
        <Checkbox id={'c-' + o.value} {checked} onCheckedChange={(v) => toggle(o.value, !!v)} />
        <Label for={'c-' + o.value}>{o.label}</Label>
      </div>
    {/each}
  </fieldset>
</section>
