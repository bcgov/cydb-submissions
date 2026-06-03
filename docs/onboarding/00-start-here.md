# CYDB Submissions — New Owner Onboarding

Welcome. You're inheriting the **Children & Youth Disability Benefit (CYDB) Submissions** application — a SvelteKit-based intake and review system deployed on BC Government OpenShift.

## What you're inheriting

| Component | Tech |
|---|---|
| Web application | SvelteKit 2, Svelte 5 (runes), TypeScript strict, adapter-node |
| Persistence | SQLite via `better-sqlite3` + Drizzle ORM |
| UI primitives | `shadcn-svelte` (built on `bits-ui`), Tailwind CSS 4 |
| Authentication | `better-auth` 1.4 — BC Gov SSO (Keycloak OIDC) primary, email/password fallback |
| Logging | `pino` with custom PII redaction |
| Validation | `zod` |
| Async work | In-process workers: OCR queue, CHEFS poller, both with halt sentinels |
| Outbound integrations | BC Gov CHEFS API, BC Gov AI Adoption Document Intelligence (OCR), BC Gov Common Hosted Email Service (CHES) |
| Tests | Vitest 4 (~292 unit cases) + Playwright (~45 E2E cases) |
| Deploy target | BC Gov OpenShift Gold cluster |

## Reading order

1. **`00-start-here.md`** — this file. Where to begin.
2. **`10-system-overview.md`** — what the product does, who uses it, and a decision log so you don't relitigate settled choices.
3. **`20-tech-stack.md`** — the project-specific Svelte 5 + SvelteKit + shadcn-svelte primer. Required if you're new to Svelte.
4. **`30-architecture.md`** — module map, request lifecycle, the hook sequence, how routes are gated by role.
5. **`40-data-model.md`** — Drizzle schema walkthrough, migrations, attachments storage.
6. **`50-auth-and-roles.md`** — better-auth wiring, BC Gov SSO flow, JIT role provisioning, the dev bypass shim.
7. **`60-workers-and-integrations.md`** — the OCR pipeline, CHEFS ingestion, CHES mailer, breaker pattern.
8. **`70-development-workflow.md`** — clone-to-PR workflow: setup, TDD ritual, tests, debugging, commit conventions.
9. **`80-deployment.md`** — OpenShift artifacts: ConfigMaps, Secrets, Deployment, Route, PVCs.
10. **`90-runbook.md`** — operational guidance: halt/resume, secret rotation, alerts, common failures and fixes.

If you have **one day** to onboard, read 00 → 20 → 30 → 70. You can ship a bug fix.

If you have **one week**, read all ten in order. By Friday you can take on a new feature and respond to a production halt.

## Quick reality check

Before you keep reading, verify the basics in a terminal:

```bash
cd cydb-submissions
node --version       # >= 22
npm --version        # >= 10
git rev-parse --show-toplevel
```

Then:

```bash
npm install
cp .env.example .env
# edit .env: at minimum set BETTER_AUTH_SECRET to 32+ random chars and
# DEV_AUTH_BYPASS=admin@test:admin,worker@test:cfd_worker,clinician@test:clinician
node scripts/migrate.mjs
./node_modules/.bin/vitest run
```

The last command should print `Test Files 52 passed (52)` and `Tests 292 passed (292)` or similar. If it doesn't, fix that before reading further — the rest of these docs assume the local toolchain is intact.

## What's NOT in here

A few things this onboarding deliberately doesn't try to do:

- **It is not a Svelte tutorial from scratch.** The primer in `20-tech-stack.md` teaches you what you need to navigate *this* codebase. If you've never written a `+page.svelte` before, plan to spend a couple of hours with the official Svelte 5 / SvelteKit docs (linked in 20) on the side.
- **It is not a BC Gov Platform Services manual.** OpenShift specifics in `80-deployment.md` cover the artifacts in this repo and the cluster-side wiring you'll touch. Cluster operations (PVC sizing changes, certificate rotation, GoldDR semantics) are the BC Gov Platform team's domain.
- **It is not a product backlog.** Decisions that have been made are documented in `10-system-overview.md`. Decisions yet to be made are tracked outside this tree.

## When you find something wrong

These docs lag the code. If you find a discrepancy:

1. The code is the truth. Trust the code.
2. Update the affected onboarding file in the same PR as your fix.
3. The next person inheriting this will thank you.
