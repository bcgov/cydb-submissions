import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { genericOAuth, keycloak } from 'better-auth/plugins/generic-oauth';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { loadSsoConfig } from '$lib/server/sso-config';
import { extractSsoRoles, syncUserRoles } from '$lib/server/sso-roles';
import { logger } from '$lib/server/log';

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
	const ssoCfg = loadSsoConfig({
		SSO_ISSUER_URL: env.SSO_ISSUER_URL,
		SSO_CLIENT_ID: env.SSO_CLIENT_ID,
		SSO_CLIENT_SECRET: env.SSO_CLIENT_SECRET
	});
	const plugins: ReturnType<typeof betterAuth>['options']['plugins'] = [
		sveltekitCookies(getRequestEvent)
	];
	if (ssoCfg) {
		plugins.push(
			genericOAuth({
				config: [
					keycloak({
						clientId: ssoCfg.clientId,
						clientSecret: ssoCfg.clientSecret,
						issuer: ssoCfg.issuer
					})
				]
			})
		);
	}

	const ssoRoleSync = async (account: { providerId?: string; userId?: string; accessToken?: string | null }) => {
		if (!ssoCfg || account.providerId !== 'keycloak' || !account.accessToken || !account.userId)
			return;
		try {
			const roles = extractSsoRoles(account.accessToken, ssoCfg.clientId);
			await syncUserRoles(db, account.userId, roles);
			if (roles.size > 0) {
				logger.info(
					{ event: 'sso_role_sync_succeeded', userId: account.userId, count: roles.size },
					'sso role sync ok'
				);
			} else {
				logger.warn(
					{ event: 'sso_role_sync_failed', userId: account.userId, reason: 'no_roles_in_token' },
					'sso token had no recognised roles; local roles unchanged'
				);
			}
		} catch (err) {
			logger.error(
				{
					event: 'sso_role_sync_failed',
					userId: account.userId,
					reason: 'exception',
					err: (err as Error).message
				},
				'sso role sync threw'
			);
		}
	};

	_auth = betterAuth({
		baseURL: env.ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'sqlite' }),
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 12,
			autoSignIn: true,
			requireEmailVerification: false
		},
		session: {
			expiresIn: 8 * 60 * 60,
			updateAge: 60 * 60
		},
		plugins,
		databaseHooks: ssoCfg
			? {
					account: {
						create: { after: ssoRoleSync },
						update: { after: ssoRoleSync }
					}
				}
			: undefined
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
