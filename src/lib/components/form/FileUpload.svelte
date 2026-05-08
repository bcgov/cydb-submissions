<script lang="ts">
  import { Label } from '$lib/components/ui/label/index.js';

  let files = $state<File[]>([]);

  function onChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    files = input.files ? Array.from(input.files) : [];
  }
</script>

<section class="space-y-2 mb-8" aria-labelledby="upload-h">
  <h2 id="upload-h" class="text-lg font-semibold">Upload assessment</h2>
  <Label for="attachments">Attach assessment documents (PDF, JPG, PNG, HEIC, DOC, DOCX)</Label>
  <input
    id="attachments"
    name="attachments"
    type="file"
    multiple
    accept="application/pdf,image/jpeg,image/png,image/heic,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    onchange={onChange}
    class="block w-full text-sm"
  />
  {#if files.length}
    <ul class="text-sm list-disc pl-5">
      {#each files as f (f.name)}<li>{f.name} ({Math.round(f.size / 1024)} KB)</li>{/each}
    </ul>
  {/if}
</section>
