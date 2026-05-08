<script lang="ts">
  import DemoNotice from '$lib/components/form/DemoNotice.svelte';
  import PanelChildInfo from '$lib/components/form/PanelChildInfo.svelte';
  import { createFormState } from '$lib/form/store.svelte';

  const state = createFormState();
</script>

<DemoNotice />
<form method="POST" enctype="multipart/form-data">
  <PanelChildInfo {state} />
</form>
