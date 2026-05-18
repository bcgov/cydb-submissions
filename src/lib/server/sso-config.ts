export interface SsoConfig {
	issuer: string;
	clientId: string;
	clientSecret: string;
}

export interface SsoEnv {
	SSO_ISSUER_URL?: string;
	SSO_CLIENT_ID?: string;
	SSO_CLIENT_SECRET?: string;
}

export function loadSsoConfig(env: SsoEnv): SsoConfig | null {
	const issuer = env.SSO_ISSUER_URL?.replace(/\/$/, '');
	if (!issuer) return null;
	if (!env.SSO_CLIENT_ID) throw new Error('SSO_CLIENT_ID is required when SSO_ISSUER_URL is set');
	if (!env.SSO_CLIENT_SECRET)
		throw new Error('SSO_CLIENT_SECRET is required when SSO_ISSUER_URL is set');
	return { issuer, clientId: env.SSO_CLIENT_ID, clientSecret: env.SSO_CLIENT_SECRET };
}
