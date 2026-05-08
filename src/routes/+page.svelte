<script lang="ts">
  import DemoNotice from '$lib/components/form/DemoNotice.svelte';
  import PanelChildInfo from '$lib/components/form/PanelChildInfo.svelte';
  import PanelDevelopmentalHistory from '$lib/components/form/PanelDevelopmentalHistory.svelte';
  import PanelDiagnosis from '$lib/components/form/PanelDiagnosis.svelte';
  import PanelFunctionalImpact from '$lib/components/form/PanelFunctionalImpact.svelte';
  import PanelCoOccurringConditions from '$lib/components/form/PanelCoOccurringConditions.svelte';
  import PanelCurrentSupports from '$lib/components/form/PanelCurrentSupports.svelte';
  import { createFormState } from '$lib/form/store.svelte';

  const form = createFormState();
</script>

<DemoNotice />
<form method="POST" enctype="multipart/form-data">
  <PanelChildInfo {form} />
  <PanelDevelopmentalHistory {form} />
  <PanelDiagnosis {form} />
  <PanelFunctionalImpact {form} />
  <PanelCoOccurringConditions {form} />
  <PanelCurrentSupports {form} />
</form>
