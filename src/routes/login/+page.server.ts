import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { getAuth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { getUserRoles } from '$lib/server/roles';
import { auditLog } from '$lib/server/audit';
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

export const load: PageServerLoad = async ({ url, locals }) => {
	if (locals.user) {
		const next = url.searchParams.get('next') ?? landingFor(locals.roles);
		throw redirect(303, next);
	}
	return { next: url.searchParams.get('next') ?? null };
};

export const actions: Actions = {
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

	default: async ({ request, url, locals }) => {
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
