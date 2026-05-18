import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { buildAuthOptions } from '$lib/server/auth-options';

type Auth = ReturnType<typeof betterAuth>;

let _auth: Auth | null = null;

// Lazy: only construct the better-auth instance when BETTER_AUTH_SECRET
// is set. Phase 1 ships without auth, so production containers without
// the secret env should not crash at module load.
let _warnedNoSecret = false;
export function getAuth(): Auth | null {
	if (_auth) return _auth;
	if (!env.BETTER_AUTH_SECRET) {
		if (!_warnedNoSecret) {
			_warnedNoSecret = true;
			console.warn(
				'auth: BETTER_AUTH_SECRET is not set — staff login will return "Auth Unavailable". ' +
					'Set it via the cydb-submissions-secrets Secret on OpenShift, or -e BETTER_AUTH_SECRET=… on podman.'
			);
		}
		return null;
	}
	if (env.BETTER_AUTH_SECRET.length < 32) {
		console.warn(
			`auth: BETTER_AUTH_SECRET is only ${env.BETTER_AUTH_SECRET.length} chars; better-auth requires 32+. Auth disabled.`
		);
		return null;
	}

	const opts = buildAuthOptions({
		BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
		ORIGIN: env.ORIGIN,
		SSO_ISSUER_URL: env.SSO_ISSUER_URL,
		SSO_CLIENT_ID: env.SSO_CLIENT_ID,
		SSO_CLIENT_SECRET: env.SSO_CLIENT_SECRET
	});

	_auth = betterAuth({
		...opts,
		database: drizzleAdapter(db, { provider: 'sqlite' }),
		plugins: [sveltekitCookies(getRequestEvent), ...(opts.plugins ?? [])]
	});
	return _auth;
}

// Backwards-compat re-export. Tools that read this at config time (e.g.
// `better-auth generate`) need a constructed instance, so we throw if
// the secret is missing — but only on access, not on module load.
export const auth = new Proxy({} as Auth, {
	get(_, prop) {
		const a = getAuth();
		if (!a) throw new Error('BETTER_AUTH_SECRET is not set; auth is disabled');
		return Reflect.get(a, prop);
	}
});
