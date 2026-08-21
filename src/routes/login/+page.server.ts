import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { getAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { getUserRoles } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
import { parseBypassConfig, applyBypass } from '$lib/server/dev-bypass';
import { safeNextUrl } from '$lib/server/security/url-safety';
import { createLoginThrottle } from '$lib/server/security/login-throttle';
import type { Role } from '$lib/server/auth-types';

const loginThrottle = createLoginThrottle({
	maxFailuresPerKey: 5,
	windowMs: 15 * 60_000,
	lockoutMs: 15 * 60_000
});

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
	const rawNext = url.searchParams.get('next');
	if (locals.user && !switching) {
		const fallback = landingFor(locals.roles);
		throw redirect(303, safeNextUrl(rawNext, url.origin, fallback));
	}
	return {
		// Raw value is fine to echo into the form's hidden input (Svelte
		// auto-escapes for HTML); the actions re-validate before redirecting.
		next: rawNext ?? null,
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

		const rawNext = form.get('next')?.toString() ?? '';
		const fallback = landingFor(new Set(target.roles));
		throw redirect(303, safeNextUrl(rawNext, url.origin, fallback));
	},

	sso: async ({ request, url, locals }) => {
		const auth = getAuth();
		if (!auth) {
			return fail(503, { error: 'Auth is not configured on the server.' });
		}
		const form = await request.formData();
		const rawNext = form.get('next')?.toString() ?? '';
		// Validate before handing off as the post-OAuth callback URL.
		const safeNext = safeNextUrl(rawNext, url.origin, '/');
		const callbackURL = new URL(safeNext, url.origin).toString();
		try {
			// better-auth 1.7 folded the genericOAuth plugin into the standard
			// social sign-in path: `signInWithOAuth2` was replaced by `signInSocial`,
			// and `providerId` by `provider`.
			const result = await auth.api.signInSocial({
				body: { provider: 'keycloak', callbackURL, disableRedirect: true },
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

	password: async ({ request, url, locals, getClientAddress }) => {
		const form = await request.formData();
		const parsed = LoginSchema.safeParse({
			email: form.get('email'),
			password: form.get('password')
		});
		if (!parsed.success) {
			return fail(400, { error: 'Invalid credentials' });
		}

		const ip = (() => {
			try {
				return getClientAddress();
			} catch {
				return 'unknown';
			}
		})();
		const decision = loginThrottle.check(ip, parsed.data.email);
		if (!decision.allowed) {
			locals.logger.warn(
				{ event: 'login_failed', reason: 'throttled', retryAfterMs: decision.retryAfterMs },
				'login throttled'
			);
			auditLog(
				'login_failed',
				{ route: url.pathname, requestId: locals.requestId, reason: 'throttled' },
				locals.logger
			);
			return fail(429, {
				error: 'Too many failed attempts. Try again in a few minutes.',
				email: parsed.data.email
			});
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
				loginThrottle.recordFailure(ip, parsed.data.email);
				return fail(401, { error: 'Invalid credentials', email: parsed.data.email });
			}
			userId = result.user.id;
		} catch {
			loginThrottle.recordFailure(ip, parsed.data.email);
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

		loginThrottle.recordSuccess(ip, parsed.data.email);
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
		const rawNext = form.get('next')?.toString() ?? '';
		const fallback = landingFor(roles);
		throw redirect(303, safeNextUrl(rawNext, url.origin, fallback));
	}
};
