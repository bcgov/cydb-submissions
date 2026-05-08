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
			return fail(503, { error: 'Auth unavailable' });
		}

		try {
			await auth.api.signInEmail({
				body: { email: parsed.data.email, password: parsed.data.password },
				headers: request.headers,
				asResponse: true
			});
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

		const session = await auth.api.getSession({ headers: request.headers });
		if (!session?.user) {
			return fail(500, { error: 'Session not established' });
		}
		const roles = await getUserRoles(db, session.user.id);
		auditLog(
			'login_succeeded',
			{
				actorUserId: session.user.id,
				route: url.pathname,
				requestId: locals.requestId
			},
			locals.logger
		);
		const next = form.get('next')?.toString() || landingFor(roles);
		throw redirect(303, next);
	}
};
