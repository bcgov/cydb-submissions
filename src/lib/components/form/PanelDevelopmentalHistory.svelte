<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';
  import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { OPTIONS } from '$lib/form/options';
  import { evaluateConditional } from '$lib/form/conditionals';
  import type { FormState } from '$lib/form/store.svelte';

  let { form }: { form: FormState } = $props();

  function dcString(): string {
    const v = form.get('developmentalHistory.developmentalConcerns');
    return v === true ? 'true' : v === false ? 'false' : '';
  }

  let dcBound = $state('');
  $effect(() => { dcBound = dcString(); });

  let ageBound = $state('');
  $effect(() => { ageBound = (form.get('developmentalHistory.ageOfFirstConcern') as string) ?? ''; });

  const showAge = $derived(
    evaluateConditional(
      { show: true, when: 'developmentalHistory.developmentalConcerns', eq: 'true' },
      form.value as unknown as Record<string, unknown>
    )
  );
</script>

<section class="space-y-4 mb-8" aria-labelledby="devhistory-h">
  <h2 id="devhistory-h" class="text-lg font-semibold">Developmental history</h2>

  <fieldset class="space-y-2">
    <legend class="text-sm">Have there been concerns about your child&rsquo;s development?</legend>
    <RadioGroup.Root
      bind:value={dcBound}
      onValueChange={(v: string) => form.set('developmentalHistory.developmentalConcerns', v === 'true')}
    >
      <div class="flex items-center gap-2">
        <RadioGroup.Item id="dc-yes" value="true" />
        <Label for="dc-yes">Yes</Label>
      </div>
      <div class="flex items-center gap-2">
        <RadioGroup.Item id="dc-no" value="false" />
        <Label for="dc-no">No</Label>
      </div>
    </RadioGroup.Root>
  </fieldset>

  {#if showAge}
    <div class="space-y-1">
      <Label for="ageOfFirstConcern">At what age were concerns first noticed?</Label>
      <Select.Root
        type="single"
        bind:value={ageBound}
        onValueChange={(v: string) => form.set('developmentalHistory.ageOfFirstConcern', v)}
      >
        <Select.Trigger id="ageOfFirstConcern" class="w-full">
          {OPTIONS.ageOfFirstConcern.find((o) => o.value === ageBound)?.label ?? 'Select…'}
        </Select.Trigger>
        <Select.Content>
          {#each OPTIONS.ageOfFirstConcern as o (o.value)}
            <Select.Item value={o.value}>{o.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/if}
</section>
