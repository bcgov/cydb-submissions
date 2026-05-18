import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, cookies }) => ({
	csrfToken: locals.csrfToken,
	user: locals.user ? { email: locals.user.email, name: locals.user.name } : null,
	bypassActive: locals.user ? Boolean(cookies.get('cydb_bypass')) : false
});
