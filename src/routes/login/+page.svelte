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
	<form method="POST" use:enhance class="space-y-4">
		<input type="hidden" name="next" value={data.next ?? ''} />
		<div class="space-y-1">
			<Label for="email">Email</Label>
			<Input id="email" name="email" type="email" required value={(form && 'email' in form ? form.email : '') ?? ''} />
		</div>
		<div class="space-y-1">
			<Label for="password">Password</Label>
			<Input id="password" name="password" type="password" required minlength={12} />
		</div>
		{#if form?.error}
			<p role="alert" class="text-sm text-red-600">{form.error}</p>
		{/if}
		<Button type="submit" class="w-full">Sign in</Button>
	</form>
</div>
