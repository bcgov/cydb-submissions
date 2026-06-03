# 20 · Tech stack primer (Svelte 5, SvelteKit, shadcn-svelte)

You came in with web + Node + TypeScript fluency. This file fills the Svelte-shaped hole. You don't need a complete Svelte course to be productive here — you need enough to read and modify the patterns this codebase already uses. That's what this file is.

External docs to keep in tabs:
- **Svelte 5** — https://svelte.dev/docs/svelte
- **SvelteKit** — https://svelte.dev/docs/kit
- **shadcn-svelte** — https://shadcn-svelte.com
- **bits-ui** (the headless primitives under shadcn-svelte) — https://bits-ui.com
- **Tailwind CSS 4** — https://tailwindcss.com/docs

Below is what you need to know to navigate *this repo*, in the order that's likely to matter.

## 1. The mental model: Svelte vs. React

If you're coming from React, every reflex maps to something, but the names differ. The biggest conceptual shift is that **Svelte is a compiler**: your `.svelte` file is transformed at build time into vanilla JS, not interpreted at runtime. Reactivity is a language feature, not a hook.

| React concept | Svelte 5 equivalent in this repo |
|---|---|
| Function component | `*.svelte` file |
| `useState(x)` | `let x = $state(initial)` |
| `useMemo(() => …)` | `let x = $derived(…)` |
| `useEffect(() => …, [deps])` | `$effect(() => …)` |
| Props (`function C({ foo })`) | `let { foo }: { foo: T } = $props()` |
| Conditional render `{ x && <A/> }` | `{#if x}<A />{/if}` |
| List render `xs.map(...)` | `{#each xs as x (x.id)}…{/each}` |
| Event handler `onClick={fn}` | `onclick={fn}` (lowercase; native DOM event names) |
| `dangerouslySetInnerHTML` | `{@html ...}` — **avoid; we don't use it** |
| Context | Svelte's `setContext` / `getContext` — we don't use it in this repo |
| Children | `import('svelte').Snippet` typed slot; `{@render children()}` |

Things that don't have direct React analogues:

- **Runes are reserved symbols, not function calls.** `$state`, `$props`, `$derived`, `$effect` look like functions but the compiler treats them as language constructs. You can't dynamically pass them around.
- **Reactivity is fine-grained by default.** When `$state` changes, only the DOM that depends on it re-renders. No virtual DOM diff.
- **`.svelte` files have three sections** (any can be omitted): a `<script>` block at the top, markup in the middle, a `<style>` block at the bottom (we rarely use it — we use Tailwind classes instead).

## 2. A minimum-viable Svelte 5 component

Here's a complete component you might write in this repo:

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';

  let { count = 0, onChange }: { count?: number; onChange?: (n: number) => void } = $props();
  let local = $state(count);
  let doubled = $derived(local * 2);

  function increment() {
    local += 1;
    onChange?.(local);
  }
</script>

<div class="space-y-2">
  <p>count: {local} · doubled: {doubled}</p>
  <Button type="button" onclick={increment}>+1</Button>
</div>
```

Things to notice:
- `lang="ts"` enables TypeScript.
- Props are destructured from `$props()` with a TS type annotation.
- `$state` makes a local variable reactive — assigning to it re-renders dependent DOM.
- `$derived` computes lazily and caches; recomputes when its dependencies change.
- `onclick` is the native DOM event attribute. (Svelte 4's `on:click` is gone in runes mode.)
- `{value}` interpolates an expression. Svelte HTML-escapes by default.
- Tailwind classes go directly in `class="…"`. Conditional classes use the `cn()` helper from `$lib/utils.ts` or `clsx`.

## 3. SvelteKit's file-system routing

SvelteKit reads `src/routes/` and maps it to URLs. **Folder = route segment**, file name = role. The role determines whether the file runs on server, client, or both.

| File | What it is | Where it runs |
|---|---|---|
| `+page.svelte` | The visual component for this route | Both — SSR on first hit, hydrates client-side |
| `+page.server.ts` | Server-side `load` function + form actions | Server only. Use for DB queries, secrets, auth. |
| `+page.ts` | Universal `load` function | Server + client. Don't put secrets here. We barely use this. |
| `+layout.svelte` | Wraps all child routes | Both |
| `+layout.server.ts` | Layout-level server load (runs for every nested route) | Server only |
| `+server.ts` | An HTTP endpoint that's *not* a page (returns JSON, streams, downloads) | Server only |
| `+error.svelte` | Custom error page for this branch of the tree | Both |
| `hooks.server.ts` | Top-level request middleware ("handles") | Server only — see `30-architecture.md` |

A few examples from this repo:

- `src/routes/+page.svelte` — the staff landing page (just renders cards linking to the staff areas).
- `src/routes/login/+page.server.ts` — the login server actions (`password`, `sso`, `devLogin`) and the `load` that decides whether to redirect already-signed-in users.
- `src/routes/login/+page.svelte` — the login form UI.
- `src/routes/admin/+page.server.ts` — admin landing; runs `requireRole('admin')` in `load`.
- `src/routes/attachments/[id]/+server.ts` — file-streaming endpoint at `/attachments/:id`, role-gated.

Square brackets `[id]` are URL params, available as `params.id` inside the load / action / handler.

## 4. Server `load` functions

A `load` function on a page runs on the server (when the type is `PageServerLoad`) before the page renders. Its return value is the data the page receives. This is where DB queries go.

Example from `src/routes/submissions/+page.server.ts`:

```ts
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { submissions } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals, url }) => {
  // 'locals' is the typed object populated by hooks.server.ts.
  // 'url' is the parsed request URL.
  const rows = await db.select().from(submissions).limit(50);
  return { submissions: rows };
};
```

In the matching `+page.svelte`:

```svelte
<script lang="ts">
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

{#each data.submissions as s (s.id)}
  <a href="/submissions/{s.submissionUuid}">{s.submitterSurname}</a>
{/each}
```

The `./$types` import is auto-generated by SvelteKit; types flow from the `load` return.

## 5. Form actions

This is the single most important SvelteKit pattern in this codebase. Forget client-side `fetch` calls — we use form actions.

A form action is an `export const actions = { … }` block in a `+page.server.ts`. Each named action handles a specific form submission via a `?/actionName` URL.

Example shape from `src/routes/admin/+page.server.ts`:

```ts
export const actions: Actions = {
  seed: async ({ request, locals, url, cookies }) => {
    requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
    const form = await request.formData();
    if (!csrfOk(form.get('csrf'), cookies.get('cydb_csrf'))) {
      return fail(403, { action: 'seed', error: 'CSRF token mismatch' });
    }
    await seedMockSubmissions(db);
    return { action: 'seed', success: 'Seeded.' };
  },
  clear: async ({ … }) => { … }
};
```

The matching markup in the `+page.svelte`:

```svelte
<form method="POST" action="?/seed" use:enhance>
  <input type="hidden" name="csrf" value={data.csrfToken} />
  <Button type="submit">Seed mock data</Button>
</form>
```

The `use:enhance` directive (imported from `$app/forms`) progressively enhances the form so a JS-enabled browser submits it without a full page reload. **It still works without JS** — that's the point of form actions vs. fetch.

Default action: if you `actions: { default: async () => { … } }` (no name), the form's `action` attribute is just `""`. **You can't have a `default` action *alongside* named actions** — SvelteKit forbids it. The login page hit this; that's why our email/password action is named `password` instead of `default`.

Return values: an action can return `{ ... }` (becomes `form` data on the page), `fail(status, { … })` (also becomes `form` data, with `status` set), or `throw redirect(303, …)`.

## 6. Hooks (server-side middleware)

`src/hooks.server.ts` is where every request enters. The `handle` export is a chain (built with `sequence(...)`) of *handle* functions, each of which receives `{ event, resolve }` and returns the response. Each handle can:

- Mutate `event.locals.*` (`event.locals.user`, `event.locals.roles`, `event.locals.logger`, etc.)
- Reject the request (return a 4xx Response, or throw `error()` / `redirect()`)
- Let it through (`return await resolve(event)`)
- Post-process the response after `resolve` returns

Our chain in order:
1. **`handlePhase1`** — boots in-process workers if first request, sets `event.locals.requestId`, populates the CSRF cookie, child-logger.
2. **`handleBetterAuth`** — invokes better-auth to populate `event.locals.user` + `event.locals.session` from the session cookie.
3. **`handlePopulateRoles`** — loads `event.locals.roles` from the DB; if no real user, applies the dev bypass shim (non-prod only).
4. **`handleRoleGuard`** — checks the request path against `ROUTE_RULES`; redirects to `/login` if unauthenticated, throws 403 if wrong role.
5. **`handleSecurityHeaders`** — applies CSP, X-Frame-Options, nosniff, HSTS (prod), Cache-Control for staff routes.

`event.locals` is the typed bag that survives across the chain. The type lives in `src/app.d.ts` (look for `interface Locals`). When you add a field, update `app.d.ts`.

## 7. Stores vs. runes

You may see `import { writable }` references in old Svelte tutorials. We don't use stores. Page-level state goes in `+page.svelte` with `$state`. Cross-component state we'd reach for **context** (`setContext` / `getContext`) but we have none of that yet.

If you find yourself wanting a global store, ask why it can't be a server load or a URL search param first.

## 8. shadcn-svelte

shadcn-svelte is **not** a component library you install. It's a CLI that **copies source files into your repo** that you then own and edit. The components are built on `bits-ui` (headless behavioural primitives — keyboard nav, focus management, ARIA wiring) and styled with Tailwind.

Our copies live in **`src/lib/components/ui/`**. Each primitive is a folder containing a couple of small `.svelte` files plus an `index.ts` barrel. For example:

```
src/lib/components/ui/
  button/
    button.svelte
    index.ts
  card/
    card.svelte
    card-content.svelte
    card-header.svelte
    card-title.svelte
    index.ts
  …
```

Usage:

```svelte
<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import * as Card from '$lib/components/ui/card';
</script>

<Card.Root>
  <Card.Header>
    <Card.Title>Hello</Card.Title>
  </Card.Header>
  <Card.Content>
    <Button>Click me</Button>
  </Card.Content>
</Card.Root>
```

Key things to know:

- **`Card.Title` is a `<div>`, not a heading element.** If you need an `h2`, render the heading separately. We learned this the hard way in a Playwright test.
- **The styling is yours.** If a component looks wrong on screen, edit the .svelte file in `$lib/components/ui/…`. There's no upstream to pull from. Run `npx shadcn-svelte add <name>` only when you need a new primitive.
- **Tailwind variants via `tailwind-variants`.** Many shadcn-svelte components export a `buttonVariants` or similar — these are how you get per-`variant` and per-`size` style sets. `cn(buttonVariants({ variant: 'outline' }), customClass)` is the typical override pattern.
- **No emoji icons.** Use `@lucide/svelte`: `import IconCheck from '@lucide/svelte/icons/check'` then `<IconCheck class="h-4 w-4" />`.

## 9. Tailwind CSS 4 in this repo

We're on Tailwind v4 (the rewrite). Key differences from Tailwind v3:
- Configuration is read from `app.css` (`@import 'tailwindcss';` plus `@theme` blocks), not a `tailwind.config.js`.
- The Vite plugin (`@tailwindcss/vite`) does the heavy lifting; there's no PostCSS pipeline.
- Default colour palette and spacing scale are slightly different from v3 — when copying classes from Stack Overflow, check they still exist.

Class composition uses the `cn()` helper:

```ts
import { cn } from '$lib/utils';
const className = cn('base classes here', condition && 'when truthy', overrides);
```

`cn` is just `clsx` + `tailwind-merge` — it merges classes while resolving Tailwind class conflicts (e.g. if you pass `px-2 px-4`, only `px-4` survives).

## 10. TypeScript strictness in this repo

The `tsconfig.json` runs strict mode. A few patterns you'll see:

- **`$types` imports** auto-typed from the route's `load`, `actions`, `Params`. Always prefer `import type { PageServerLoad, Actions } from './$types'` over typing return values manually.
- **`$lib/server/*` is server-only.** SvelteKit will error at build time if you import a `server/` module from a `.svelte` file. Use this to enforce the boundary — anything under `$lib/server/db`, `$lib/server/auth`, `$lib/server/ocr` is safe to put secrets in.
- **`vi.fn` casts.** In tests, `fakeFetch.mock.calls[0]` is typed as `[]` (the empty arg tuple inferred from the never-called signature) until the first call. Cast via `as unknown as [string, RequestInit]` if you need to inspect args.
- **`Set<Role>` not `Role[]`** for role checks. The `roles` and `auth-types.ts` modules treat the role allowlist as a set.

## 11. Where Svelte conventions intersect with this app

A small set of things to remember:

- **Server load functions only see HTTPS cookies that were set with `httpOnly`.** Client `document.cookie` reads will not see our session cookie. If you need state on the client, return it from `load`.
- **`form` is reserved as the result of an action.** In `+page.svelte`, `let { form, data }: { form: ActionData; data: PageData } = $props()`. `form` is null until an action runs.
- **`fail(status, payload)` vs. `throw error(status)`.** `fail` returns a typed payload to the page; `error` produces SvelteKit's standard error response (status code + `+error.svelte` route).
- **Avoid `onMount` / `$effect` for fetches.** Page data should come from `load`. If you reach for `onMount(async () => fetch(…))` you're probably doing it wrong; rethink the data flow.

## 12. Recommended ramp

If you've used React but not Svelte:
- Watch the **"Svelte 5 in 30 minutes"** rune-focused intro on the official site (svelte.dev/tutorial).
- Skim the SvelteKit routing page top-to-bottom.
- Then come back here and re-read this file with the official terminology fresh in mind.

If you've never used a component framework but have written HTML/CSS/JS: that's enough; the official Svelte tutorial is incremental. Plan for a day.

When you're stuck, the patterns that exist in this codebase are mostly canonical. `grep -rn 'use:enhance'` will show you how forms are wired; `grep -rn '+page.server.ts'` lists every server load; `grep -rn '\$state\|\$derived\|\$effect'` shows every reactive primitive. Read three or four of each before writing your own.

## 13. Manticore Search (full-text search sidecar)

The `/submissions` admin view includes advanced full-text search across all fields in the current status-filtered set. The engine behind it is **Manticore Search** — not a Node library, but a separate process running as a **sidecar container in the same app Pod** (image `manticoresearch/manticore:25.0.0`, reachable at `localhost:9308`). The app talks to it with plain `fetch` calls over Manticore's HTTP API (`/search` for JSON DSL queries, `/sql` for ad-hoc SQL); there is no extra npm dependency and nothing leaves the cluster.

Why Manticore instead of SQLite FTS or an external cloud service: the requirement called for advanced search syntax — wildcards (`aut*`, `*ism*`), phrases (`"speech delay"`), field scoping (`@ocr_text vineland`), proximity (`NEAR/3`), quorum (`"a b c"/2`), exclusion (`-term`), true English lemmatisation, and fuzzy/typo tolerance on by default — all of which Manticore handles self-contained, with no external service to provision or pay for.

**SQLite stays the source of truth.** A search returns document IDs, relevance scores, and highlighted snippets; the server then re-fetches the matching rows from SQLite and re-applies role/status authorisation. Search results can never widen access beyond what the DB query would have returned anyway.

The index (`submissions_idx`) is kept current by a real-time push whenever OCR completes, plus a background reconciler that catches anything missed (driven by a `search_indexed_at` dirty-marker column on `submissions`). Manticore reachability is part of the `/readyz` health check — if the sidecar is down, the pod reports not-ready (HTTP 503).

**Where the code lives**

- `src/lib/server/search/` — types, Manticore HTTP client, document builder, indexer, query/hydration pipeline, reconciler, singleton, health check.
- `src/routes/submissions/+page.svelte` + `+page.server.ts` — UI search box and the load branch that dispatches to the search pipeline.

**Env vars**

| Variable | Default | Purpose |
|---|---|---|
| `MANTICORE_URL` | `http://localhost:9308` | Sidecar address |
| `SEARCH_RECONCILE_INTERVAL_MS` | `2000` | Reconciler poll cadence |
| `SEARCH_RECONCILE_BATCH` | `50` | Rows per reconciler batch |

Local dev: `podman compose -f compose.search.yaml up -d` starts the sidecar. See `30-architecture.md` for how the sidecar fits into the request lifecycle and `80-deployment.md` for Pod/container configuration.
