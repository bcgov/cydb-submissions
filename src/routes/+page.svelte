<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<div class="py-12 text-center space-y-6">
	<h2 class="text-xl font-semibold">CYDB staff portal</h2>
	<p class="text-gray-700">
		The Children &amp; Youth Disability Benefit application form is now hosted in
		<a class="underline" href="https://submit.digital.gov.bc.ca">BC Gov CHEFS</a>.
		Staff sign in here to review submissions and run the evaluation workflow.
	</p>
	{#if !data.user}
		<p>
			<a href="/login" class="underline text-blue-700">Sign in →</a>
		</p>
	{:else}
		<p>
			<a href="/submissions" class="underline text-blue-700">Go to submissions →</a>
		</p>
	{/if}
</div>
