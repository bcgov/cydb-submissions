import type { Actions } from './$types';
import { redirect } from '@sveltejs/kit';
import { getAuth } from '$lib/server/auth';
import { auditLog } from '$lib/server/audit';

export const actions: Actions = {
	default: async ({ request, locals, url, cookies }) => {
		const auth = getAuth();
		if (auth) {
			try {
				await auth.api.signOut({ headers: request.headers });
			} catch {
				// session may already be gone — proceed
			}
		}
		// Clear the dev bypass cookie too so a logout fully terminates a bypass session.
		cookies.delete('cydb_bypass', { path: '/' });

		if (locals.user) {
			auditLog(
				'logout',
				{
					actorUserId: locals.user.id,
					route: url.pathname,
					requestId: locals.requestId
				},
				locals.logger
			);
		}
		throw redirect(303, '/login');
	}
};
