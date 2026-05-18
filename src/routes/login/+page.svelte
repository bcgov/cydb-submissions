<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<div class="mx-auto max-w-sm py-16 px-4">
	<h1 class="text-2xl font-semibold mb-6">Sign in</h1>

	<form method="POST" action="?/sso" use:enhance class="mb-4">
		<input type="hidden" name="next" value={data.next ?? ''} />
		<Button type="submit" class="w-full">Sign in with BC Gov SSO</Button>
	</form>

	{#if form?.error}
		<p role="alert" class="text-sm text-red-600 mb-3">{form.error}</p>
	{/if}

	<details class="mt-6 border-t pt-4 text-sm">
		<summary class="cursor-pointer text-muted-foreground select-none">
			Sign in with a clinician password instead
		</summary>
		<form method="POST" action="?/default" use:enhance class="space-y-4 pt-4">
			<input type="hidden" name="next" value={data.next ?? ''} />
			<div class="space-y-1">
				<Label for="email">Email</Label>
				<Input id="email" name="email" type="email" required value={(form && 'email' in form ? form.email : '') ?? ''} />
			</div>
			<div class="space-y-1">
				<Label for="password">Password</Label>
				<Input id="password" name="password" type="password" required minlength={12} />
			</div>
			<Button type="submit" variant="secondary" class="w-full">Sign in with password</Button>
		</form>
	</details>
</div>
