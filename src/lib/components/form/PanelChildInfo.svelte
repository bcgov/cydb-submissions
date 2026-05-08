<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { OPTIONS } from '$lib/form/options';
  import type { FormState } from '$lib/form/store.svelte';

  let { form }: { form: FormState } = $props();

  let dob = $state('');
  $effect(() => { dob = (form.get('childInfo.dateOfBirth') as string) ?? ''; });

  let language = $state('');
  $effect(() => { language = (form.get('childInfo.primaryLanguage') as string) ?? ''; });
</script>

<section class="space-y-4 mb-8" aria-labelledby="childInfo-h">
  <h2 id="childInfo-h" class="text-lg font-semibold">Child information</h2>

  <div class="space-y-1">
    <Label for="dateOfBirth">Child&rsquo;s date of birth</Label>
    <Input
      id="dateOfBirth"
      type="date"
      required
      bind:value={dob}
      oninput={(e) => form.set('childInfo.dateOfBirth', (e.currentTarget as HTMLInputElement).value)}
    />
  </div>

  <div class="space-y-1">
    <Label for="primaryLanguage">Primary language spoken at home</Label>
    <Select.Root
      type="single"
      bind:value={language}
      onValueChange={(v: string) => form.set('childInfo.primaryLanguage', v)}
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
