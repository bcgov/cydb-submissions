# Archived: in-app public submission form

These files implemented the in-app rendering and server-side validation of the
CYDB intake form (Phase 1). They are preserved here because the project has
moved to CHEFS-hosted intake (see `docs/superpowers/plans/2026-05-17-chefs-ingestion.md`),
but the work may be useful as a reference or starting point if the in-app form
needs to return.

## Contents

- `+page.svelte` — the form UI; imports panel components from
  `src/lib/components/form/`. Those components are still present in the active
  source tree (they are no longer reachable through routing, but they remain on
  disk).
- `+page.server.ts` — the SvelteKit default form action: CSRF check, Zod
  validation, attachment persistence, and `writeValidSubmission` /
  `writeInvalidSubmission` dispatch.
- `e2e/` — Playwright specs that exercised the form (submit happy/invalid
  paths, file upload, demo notice, and per-panel rendering). They reference
  `goto('/')` and will not work as-is until the route is restored.

## How to restore

```
git mv archive/public-form/+page.svelte src/routes/+page.svelte
git mv archive/public-form/+page.server.ts src/routes/+page.server.ts
git mv archive/public-form/e2e/*.spec.ts tests/e2e/
```

Then re-add a replacement landing or delete `src/routes/+page.svelte` first.
The Zod validator (`src/lib/form/schema.ts`) and option lists
(`src/lib/form/options.ts`) are still in use by the CHEFS ingestion pipeline,
so the form's validation behaviour is preserved automatically.
