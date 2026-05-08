import type { PageServerLoad } from './$types';
import { requireRole } from '$lib/server/roles';

export const load: PageServerLoad = async ({ locals }) => {
	requireRole({ user: locals.user ?? null, roles: locals.roles }, 'admin');
	return {};
};
