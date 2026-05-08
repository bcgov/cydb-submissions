<script lang="ts">
  import DemoNotice from '$lib/components/form/DemoNotice.svelte';
  import PanelChildInfo from '$lib/components/form/PanelChildInfo.svelte';
  import PanelDevelopmentalHistory from '$lib/components/form/PanelDevelopmentalHistory.svelte';
  import { createFormState } from '$lib/form/store.svelte';

  const form = createFormState();
</script>

<DemoNotice />
<form method="POST" enctype="multipart/form-data">
  <PanelChildInfo {form} />
  <PanelDevelopmentalHistory {form} />
</form>
