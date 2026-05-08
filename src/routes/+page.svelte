<script lang="ts">
  import DemoNotice from '$lib/components/form/DemoNotice.svelte';
  import PanelChildInfo from '$lib/components/form/PanelChildInfo.svelte';
  import PanelDevelopmentalHistory from '$lib/components/form/PanelDevelopmentalHistory.svelte';
  import PanelDiagnosis from '$lib/components/form/PanelDiagnosis.svelte';
  import PanelFunctionalImpact from '$lib/components/form/PanelFunctionalImpact.svelte';
  import PanelCoOccurringConditions from '$lib/components/form/PanelCoOccurringConditions.svelte';
  import PanelCurrentSupports from '$lib/components/form/PanelCurrentSupports.svelte';
  import FileUpload from '$lib/components/form/FileUpload.svelte';
  import PanelConsent from '$lib/components/form/PanelConsent.svelte';
  import { Button } from '$lib/components/ui/button/index.js';
  import { createFormState } from '$lib/form/store.svelte';

  let { data, form: actionForm } = $props();
  const form = createFormState();

  // Browser fingerprint: low-entropy, deterministic, non-PII.
  function fingerprint(): string {
    if (typeof navigator === 'undefined') return '';
    const parts = [navigator.userAgent, navigator.language, screen.width, screen.height, screen.colorDepth, new Date().getTimezoneOffset()];
    return btoa(parts.join('|')).slice(0, 64);
  }

  let fp = $state('');
  $effect(() => { fp = fingerprint(); });

  let payloadJson = $derived(JSON.stringify(form.value));
</script>

<DemoNotice />
{#if actionForm?.error}
  <div role="alert" class="mb-4 p-3 border border-destructive text-destructive">{actionForm.error}</div>
{/if}
{#if actionForm?.success}
  <div role="status" class="mb-4 p-3 border border-green-600">Submission received. Reference: {actionForm.submissionUuid}</div>
{/if}

<form method="POST" enctype="multipart/form-data" novalidate>
  <input type="hidden" name="payload" value={payloadJson} />
  <input type="hidden" name="csrfTokenEcho" value={data?.csrfToken ?? ''} />
  <input type="hidden" name="browserFingerprint" value={fp} />
  <!-- honeypot -->
  <div style="position:absolute;left:-9999px" aria-hidden="true">
    <label>Do not fill: <input name="website" tabindex="-1" autocomplete="off" /></label>
  </div>

  <PanelChildInfo {form} />
  <PanelDevelopmentalHistory {form} />
  <PanelDiagnosis {form} />
  <PanelFunctionalImpact {form} />
  <PanelCoOccurringConditions {form} />
  <PanelCurrentSupports {form} />
  <FileUpload />
  <PanelConsent {form} />

  <Button type="submit">Submit</Button>
</form>
