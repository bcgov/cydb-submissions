<script lang="ts">
	import '../app.css';
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import type { LayoutData } from './$types';
	let { children, data }: { children: import('svelte').Snippet; data: LayoutData } = $props();
</script>

<div class="min-h-screen bg-background text-foreground">
	<header class="border-b">
		<div class="mx-auto flex max-w-3xl items-center justify-between p-4">
			<div>
				<h1 class="text-xl font-semibold">Children &amp; Youth Disability Benefit</h1>
				<p class="text-sm text-muted-foreground">Application form</p>
			</div>
			{#if data.user}
				<form method="POST" action="/logout" use:enhance class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground">{data.user.email}</span>
					{#if data.bypassActive}
						<span
							class="rounded border border-yellow-500/60 bg-yellow-50 px-1.5 py-0.5 text-xs text-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200"
							title="Signed in via DEV_AUTH_BYPASS"
						>
							dev
						</span>
						<a
							href="/login?switch=1"
							class="text-xs text-muted-foreground underline hover:text-foreground"
						>
							Switch
						</a>
					{/if}
					<Button type="submit" variant="outline" size="sm">Sign out</Button>
				</form>
			{/if}
		</div>
	</header>
	<main class="p-4">
		{@render children()}
	</main>
</div>
