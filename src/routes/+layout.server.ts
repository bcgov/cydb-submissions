import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	csrfToken: locals.csrfToken,
	user: locals.user ? { email: locals.user.email, name: locals.user.name } : null
});
