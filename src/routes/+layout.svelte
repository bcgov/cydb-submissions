<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<div class="min-h-screen bg-background text-foreground">
  <header class="border-b">
    <div class="max-w-3xl mx-auto p-4">
      <h1 class="text-xl font-semibold">Children &amp; Youth Disability Benefit</h1>
      <p class="text-sm text-muted-foreground">Application form</p>
    </div>
  </header>
  <main class="max-w-3xl mx-auto p-4">
    {@render children()}
  </main>
</div>
