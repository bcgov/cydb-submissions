import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { getUserRoles } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { parseBypassConfig, applyBypass } from '$lib/server/dev-bypass';
import type { Role } from '$lib/server/auth-types';

const LoginSchema = z.object({
	email: z.string().email().max(254),
	password: z.string().min(1).max(256)
});

function landingFor(roles: Set<Role>): string {
	if (roles.has('admin')) return '/admin';
	if (roles.has('cfd_worker')) return '/submissions';
	if (roles.has('clinician')) return '/clinician';
	return '/';
}

function devPersonas() {
	if (env.NODE_ENV === 'production') return null;
	try {
		const cfg = parseBypassConfig(env.DEV_AUTH_BYPASS);
		if (!cfg) return null;
		return cfg.map((p) => ({
			email: p.email,
			roles: p.roles,
			landing: landingFor(new Set(p.roles))
		}));
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async ({ url, locals }) => {
	const switching = url.searchParams.has('switch');
	if (locals.user && !switching) {
		const next = url.searchParams.get('next') ?? landingFor(locals.roles);
		throw redirect(303, next);
	}
	return {
		next: url.searchParams.get('next') ?? null,
		personas: devPersonas()
	};
};

export const actions: Actions = {
	devLogin: async ({ request, cookies, locals, url }) => {
		if (env.NODE_ENV === 'production') {
			return fail(403, { error: 'dev impersonation is disabled in production' });
		}
		const cfg = (() => {
			try {
				return parseBypassConfig(env.DEV_AUTH_BYPASS);
			} catch {
				return null;
			}
		})();
		if (!cfg) {
			return fail(503, { error: 'DEV_AUTH_BYPASS is not configured' });
		}
		const form = await request.formData();
		const email = form.get('email')?.toString() ?? '';
		const target = cfg.find((p) => p.email === email);
		if (!target) {
			return fail(400, { error: `unknown persona: ${email}` });
		}

		// Clear any prior better-auth or bypass session so the new persona
		// wins on the next request.
		const auth = getAuth();
		if (auth) {
			try {
				await auth.api.signOut({ headers: request.headers });
			} catch {
				/* nothing to sign out of */
			}
		}
		cookies.set('cydb_bypass', target.email, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: false
		});

		// Pre-seed the user+roles so the redirect target's load function
		// sees the new identity on this same response cycle (the bypass
		// cookie alone takes effect on the *next* request).
		await applyBypass(db, cfg, target.email);

		auditLog(
			'auth_bypass_applied',
			{
				actorUserId: target.email,
				actorRole: target.roles[0],
				route: url.pathname,
				requestId: locals.requestId,
				reason: 'dev_impersonation_button'
			},
			locals.logger
		);

		const next = form.get('next')?.toString() || landingFor(new Set(target.roles));
		throw redirect(303, next);
	},

	sso: async ({ request, url, locals }) => {
		const auth = getAuth();
		if (!auth) {
			return fail(503, { error: 'Auth is not configured on the server.' });
		}
		const form = await request.formData();
		const next = form.get('next')?.toString() || '/';
		// Resolve relative redirect targets against this origin so the BC Gov
		// SSO callback handler can verify them as same-origin.
		const callbackURL = new URL(next, url.origin).toString();
		try {
			const result = await auth.api.signInWithOAuth2({
				body: { providerId: 'keycloak', callbackURL, disableRedirect: true },
				headers: request.headers
			});
			if (!result?.url) {
				locals.logger.error(
					{ event: 'sso_login_failed', reason: 'no_redirect_url' },
					'better-auth returned no URL for SSO sign-in'
				);
				return fail(503, { error: 'SSO is currently unavailable.' });
			}
			throw redirect(303, result.url);
		} catch (e) {
			if ((e as { status?: number }).status === 303) throw e;
			locals.logger.error(
				{ event: 'sso_login_failed', err: (e as Error).message },
				'sso init threw'
			);
			return fail(503, { error: 'SSO is currently unavailable.' });
		}
	},

	password: async ({ request, url, locals }) => {
		const form = await request.formData();
		const parsed = LoginSchema.safeParse({
			email: form.get('email'),
			password: form.get('password')
		});
		if (!parsed.success) {
			return fail(400, { error: 'Invalid credentials' });
		}

		const auth = getAuth();
		if (!auth) {
			locals.logger.error(
				{ event: 'login_failed', reason: 'auth_unconfigured' },
				'login attempted but BETTER_AUTH_SECRET is not set'
			);
			return fail(503, {
				error: 'Auth is not configured on the server. Set BETTER_AUTH_SECRET (32+ chars) and redeploy.'
			});
		}

		let userId: string;
		try {
			const result = await auth.api.signInEmail({
				body: { email: parsed.data.email, password: parsed.data.password },
				headers: request.headers
			});
			if (!result?.user?.id) {
				return fail(401, { error: 'Invalid credentials', email: parsed.data.email });
			}
			userId = result.user.id;
		} catch {
			auditLog(
				'login_failed',
				{
					route: url.pathname,
					requestId: locals.requestId,
					reason: 'bad credentials'
				},
				locals.logger
			);
			return fail(401, { error: 'Invalid credentials', email: parsed.data.email });
		}

		const roles = await getUserRoles(db, userId);
		auditLog(
			'login_succeeded',
			{
				actorUserId: userId,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		const next = form.get('next')?.toString() || landingFor(roles);
		throw redirect(303, next);
	}
};
