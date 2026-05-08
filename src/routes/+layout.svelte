<script lang="ts">
	import '../app.css';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import type { LayoutData } from './$types';
	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();
</script>

<div class="min-h-screen bg-background text-foreground">
	<header class="border-b">
		<div class="max-w-3xl mx-auto p-4 flex items-center justify-between">
			<div>
				<h1 class="text-xl font-semibold">Children &amp; Youth Disability Benefit</h1>
				<p class="text-sm text-muted-foreground">Application form</p>
			</div>
			{#if data.user}
				<form method="POST" action="/logout" use:enhance class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">{data.user.email}</span>
					<Button type="submit" variant="outline" size="sm">Sign out</Button>
				</form>
			{/if}
		</div>
	</header>
	<main class="max-w-3xl mx-auto p-4">
		{@render children()}
	</main>
</div>
