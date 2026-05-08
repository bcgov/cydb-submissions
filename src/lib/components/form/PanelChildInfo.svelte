<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { OPTIONS } from '$lib/form/options';
  import type { FormState } from '$lib/form/store.svelte';

  let { state }: { state: FormState } = $props();

  const language = $derived((state.get('childInfo.primaryLanguage') as string) ?? '');
  const dob = $derived((state.get('childInfo.dateOfBirth') as string) ?? '');
</script>

<section class="space-y-4 mb-8" aria-labelledby="childInfo-h">
  <h2 id="childInfo-h" class="text-lg font-semibold">Child information</h2>

  <div class="space-y-1">
    <Label for="dateOfBirth">Child&rsquo;s date of birth</Label>
    <Input
      id="dateOfBirth"
      type="date"
      required
      value={dob}
      oninput={(e) => state.set('childInfo.dateOfBirth', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1">
    <Label for="primaryLanguage">Primary language spoken at home</Label>
    <Select.Root
      type="single"
      value={language}
      onValueChange={(v) => state.set('childInfo.primaryLanguage', v)}
    >
      <Select.Trigger id="primaryLanguage" class="w-full">
        {OPTIONS.primaryLanguage.find((o) => o.value === language)?.label ?? 'Select…'}
      </Select.Trigger>
      <Select.Content>
        {#each OPTIONS.primaryLanguage as o (o.value)}
          <Select.Item value={o.value}>{o.label}</Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
  </div>
</section>
