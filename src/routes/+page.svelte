<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<div class="space-y-6 py-12 text-center">
	<h2 class="text-xl font-semibold">CYDB staff portal</h2>
	<p class="text-gray-700">
		The Children &amp; Youth Disability Benefit application form is now hosted in
		<a class="underline" href="https://submit.digital.gov.bc.ca">BC Gov CHEFS</a>. Staff sign in
		here to review submissions and run the evaluation workflow.
	</p>
	{#if !data.user}
		<p>
			<a href="/login" class="text-blue-700 underline">Sign in →</a>
		</p>
	{:else}
		<p>
			<a href="/submissions" class="text-blue-700 underline">Go to submissions →</a>
		</p>
	{/if}
</div>
