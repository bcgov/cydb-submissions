<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { OPTIONS } from '$lib/form/options';
  import type { FormState } from '$lib/form/store.svelte';

  let { form }: { form: FormState } = $props();

  const fields = [
    { key: 'communication', label: 'Communication difficulties' },
    { key: 'socialInteraction', label: 'Social interaction difficulties' },
    { key: 'dailyLivingSkills', label: 'Daily living skills challenges' },
    { key: 'behaviouralConcerns', label: 'Behavioural regulation concerns' }
  ] as const;

  let bound = $state<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.key, (form.get(`functionalImpact.${f.key}`) as string) ?? '']))
  );
  $effect(() => {
    bound = Object.fromEntries(
      fields.map((f) => [f.key, (form.get(`functionalImpact.${f.key}`) as string) ?? ''])
    );
  });
</script>

<section class="space-y-4 mb-8" aria-labelledby="fi-h">
  <h2 id="fi-h" class="text-lg font-semibold">Functional impact</h2>
  {#each fields as f (f.key)}
    <div class="space-y-1">
      <Label for={f.key}>{f.label}</Label>
      <Select.Root
        type="single"
        bind:value={bound[f.key]}
        onValueChange={(v: string) => form.set(`functionalImpact.${f.key}`, v)}
      >
        <Select.Trigger id={f.key} class="w-full">
          {OPTIONS[f.key].find((o) => o.value === bound[f.key])?.label ?? 'Select…'}
        </Select.Trigger>
        <Select.Content>
          {#each OPTIONS[f.key] as o (o.value)}
            <Select.Item value={o.value}>{o.label}</Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
  {/each}
</section>
