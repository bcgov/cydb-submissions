<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';
  import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { OPTIONS } from '$lib/form/options';
  import type { FormState } from '$lib/form/store.svelte';

  let { form }: { form: FormState } = $props();

  function hfdString(): string {
    const v = form.get('diagnosis.hasFormalDiagnosis');
    return v === true ? 'true' : v === false ? 'false' : '';
  }
  let hfdBound = $state('');
  $effect(() => { hfdBound = hfdString(); });

  let dxStatus = $state('');
  $effect(() => { dxStatus = (form.get('diagnosis.diagnosticStatus') as string) ?? ''; });

  function toggleTool(value: string, checked: boolean) {
    const cur = (form.get('diagnosis.assessmentTools') as string[]) ?? [];
    form.set('diagnosis.assessmentTools',
      checked ? Array.from(new Set([...cur, value])) : cur.filter((v) => v !== value));
  }
</script>

<section class="space-y-4 mb-8" aria-labelledby="diag-h">
  <h2 id="diag-h" class="text-lg font-semibold">Diagnosis</h2>

  <fieldset class="space-y-2">
    <legend class="text-sm">Has your child received a formal autism diagnosis?</legend>
    <RadioGroup.Root
      bind:value={hfdBound}
      onValueChange={(v: string) => form.set('diagnosis.hasFormalDiagnosis', v === 'true')}
    >
      <div class="flex items-center gap-2">
        <RadioGroup.Item id="hfd-yes" value="true" />
        <Label for="hfd-yes">Yes</Label>
      </div>
      <div class="flex items-center gap-2">
        <RadioGroup.Item id="hfd-no" value="false" />
        <Label for="hfd-no">No</Label>
      </div>
    </RadioGroup.Root>
  </fieldset>

  <div class="space-y-1">
    <Label for="diagnosticStatus">Diagnostic status</Label>
    <Select.Root
      type="single"
      bind:value={dxStatus}
      onValueChange={(v: string) => form.set('diagnosis.diagnosticStatus', v)}
    >
      <Select.Trigger id="diagnosticStatus" class="w-full">
        {OPTIONS.diagnosticStatus.find((o) => o.value === dxStatus)?.label ?? 'Select…'}
      </Select.Trigger>
      <Select.Content>
        {#each OPTIONS.diagnosticStatus as o (o.value)}
          <Select.Item value={o.value}>{o.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>

  <fieldset class="space-y-2">
    <legend class="text-sm">Assessment tools used (if known)</legend>
    {#each OPTIONS.assessmentTools as o (o.value)}
      {@const checked = ((form.get('diagnosis.assessmentTools') as string[]) ?? []).includes(o.value)}
      <div class="flex items-center gap-2">
        <Checkbox
          id={'at-' + o.value}
          {checked}
          onCheckedChange={(v) => toggleTool(o.value, !!v)}
        />
        <Label for={'at-' + o.value}>{o.label}</Label>
      </div>
    {/each}
  </fieldset>
</section>
