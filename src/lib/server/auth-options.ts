import type { BetterAuthOptions } from 'better-auth';
import { genericOAuth, keycloak } from 'better-auth/plugins/generic-oauth';
import { loadSsoConfig } from './sso-config';
import { extractSsoRoles, syncUserRoles } from './sso-roles';
import { logger } from './log';
import { db } from './db';

export interface AuthEnv {
	BETTER_AUTH_SECRET?: string;
	ORIGIN?: string;
	SSO_ISSUER_URL?: string;
	SSO_CLIENT_ID?: string;
	SSO_CLIENT_SECRET?: string;
}

interface SsoAccountLike {
	providerId?: string;
	userId?: string;
	accessToken?: string | null;
}

interface SsoSessionLike {
	userId?: string;
}

/**
 * Builds the better-auth options object. Extracted as a pure function so the
 * security suite can introspect plugin configuration (PKCE, password-reset,
 * audit hooks) without standing up a full Auth instance.
 */
export function buildAuthOptions(env: AuthEnv): BetterAuthOptions {
	const ssoCfg = loadSsoConfig({
		SSO_ISSUER_URL: env.SSO_ISSUER_URL,
		SSO_CLIENT_ID: env.SSO_CLIENT_ID,
		SSO_CLIENT_SECRET: env.SSO_CLIENT_SECRET
	});

	const plugins: Array<ReturnType<typeof genericOAuth>> = [];
	if (ssoCfg) {
		plugins.push(
			genericOAuth({
				config: [
					{
						...keycloak({
							clientId: ssoCfg.clientId,
							clientSecret: ssoCfg.clientSecret,
							issuer: ssoCfg.issuer
						}),
						pkce: true,
						// Request the email scope explicitly, and map BC Gov IDIR claims to
						// better-auth's required `email` + `name` so a first-time IDIR user is
						// provisioned (JIT) rather than failing with email_is_missing /
						// name_is_missing. IDIR may supply the display name as `display_name`
						// or only given/family parts rather than `name`.
						scopes: ['openid', 'profile', 'email'],
						mapProfileToUser: (profile: Record<string, unknown>) => {
							const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : undefined);
							const fullName = [str(profile.given_name), str(profile.family_name)]
								.filter(Boolean)
								.join(' ');
							return {
								email: str(profile.email),
								name:
									str(profile.name) ??
									str(profile.display_name) ??
									str(fullName) ??
									str(profile.preferred_username)
							};
						}
					}
				]
			})
		);
	}

	const ssoRoleSync = async (account: SsoAccountLike) => {
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

	const sessionAfter = async (session: SsoSessionLike) => {
		// Best-effort SSO-login audit. We only have the session row at this
		// point; if the user's most-recent account is the keycloak one, that's
		// almost certainly the IdP that just produced this session.
		if (!session?.userId) return;
		logger.info({ event: 'sso_login_succeeded', userId: session.userId }, 'sso session created');
	};

	return {
		baseURL: env.ORIGIN,
		secret: env.BETTER_AUTH_SECRET,
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 12,
			autoSignIn: true,
			requireEmailVerification: false
			// Password-reset surface is intentionally disabled: we never configure
			// `sendResetPassword`, and better-auth treats an absent sender as
			// "reset disabled" at runtime (no reset endpoint is exposed).
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
					},
					session: {
						create: { after: sessionAfter }
					}
				}
			: undefined
	};
}
