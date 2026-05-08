<script lang="ts">
  import { Checkbox } from '$lib/components/ui/checkbox/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import type { FormState } from '$lib/form/store.svelte';

  let { form }: { form: FormState } = $props();
</script>

<section class="space-y-4 mb-8" aria-labelledby="consent-h">
  <h2 id="consent-h" class="text-lg font-semibold">Consent</h2>
  <div class="flex items-start gap-2">
    <Checkbox
      id="ia"
      checked={form.get('consent.informationAccurate') === true}
      onCheckedChange={(v) => form.set('consent.informationAccurate', !!v)}
    />
    <Label for="ia">I confirm the information provided is accurate</Label>
  </div>
  <div class="flex items-start gap-2">
    <Checkbox
      id="ds"
      checked={form.get('consent.dataSharingConsent') === true}
      onCheckedChange={(v) => form.set('consent.dataSharingConsent', !!v)}
    />
    <Label for="ds">I consent to the use and sharing of this information for program administration</Label>
  </div>
</section>
