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

	{#if data.personas && data.personas.length > 0}
		<section
			class="mt-6 rounded-md border border-dashed border-yellow-500/60 bg-yellow-50 dark:bg-yellow-950/30 p-4"
			aria-labelledby="dev-impersonation-heading"
		>
			<h2 id="dev-impersonation-heading" class="text-sm font-semibold mb-1">
				Dev impersonation
			</h2>
			<p class="text-xs text-muted-foreground mb-3">
				Active only when <code>DEV_AUTH_BYPASS</code> is set and
				<code>NODE_ENV</code> isn't <code>production</code>. One click signs in as the chosen
				persona — useful for exercising role-gated routes locally.
			</p>
			<ul class="space-y-2">
				{#each data.personas as p (p.email)}
					<li>
						<form method="POST" action="?/devLogin" use:enhance class="flex items-center gap-2">
							<input type="hidden" name="email" value={p.email} />
							<input type="hidden" name="next" value={data.next ?? p.landing} />
							<Button type="submit" variant="outline" size="sm" class="flex-1 justify-start">
								<span class="font-mono text-xs">{p.email}</span>
								<span class="ml-auto text-xs text-muted-foreground">{p.roles.join(' + ')}</span>
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<details class="mt-6 border-t pt-4 text-sm">
		<summary class="cursor-pointer text-muted-foreground select-none">
			Sign in with a clinician password instead
		</summary>
		<form method="POST" action="?/password" use:enhance class="space-y-4 pt-4">
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
