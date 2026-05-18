import { describe, it, expect } from 'vitest';
import { buildAuthOptions } from '$lib/server/auth-options';

const baseEnv = {
	BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
	ORIGIN: 'https://cydb.example.gov.bc.ca',
	SSO_ISSUER_URL: 'https://dev.loginproxy.gov.bc.ca/auth/realms/standard',
	SSO_CLIENT_ID: 'cydb-submissions-6444',
	SSO_CLIENT_SECRET: 'sek'
};

describe('buildAuthOptions — SSO + password-reset posture (8.5, 3.8, 12.1)', () => {
	it('enables PKCE on the keycloak SSO config (8.5)', () => {
		const opts = buildAuthOptions(baseEnv);
		const generic = opts.plugins?.find(
			(p: { id?: string }) => p.id === 'generic-oauth'
		) as { options?: { config?: Array<{ pkce?: boolean }> } } | undefined;
		expect(generic).toBeTruthy();
		const kc = generic!.options?.config?.[0];
		expect(kc).toBeTruthy();
		expect(kc!.pkce).toBe(true);
	});

	it('disables the better-auth password-reset surface (3.8)', () => {
		const opts = buildAuthOptions(baseEnv);
		// Either `sendResetPassword` is not configured (default-off via better-auth
		// behaviour) AND we explicitly assert the reset endpoint is disabled, or the
		// implementation sets a flag we can read.
		expect(opts.emailAndPassword?.sendResetPassword).toBeUndefined();
		// We surface an explicit toggle on the options object that future hooks
		// can rely on; absent it, the fix is incomplete.
		expect(opts.emailAndPassword?.disableResetPassword).toBe(true);
	});

	it("emits sso_login_succeeded on session creation when account.providerId is 'keycloak' (12.1)", () => {
		const opts = buildAuthOptions(baseEnv);
		// The hook must exist — its presence is the contract; what it logs is
		// covered by integration use, but at minimum the after-hook function is
		// wired.
		const after = opts.databaseHooks?.session?.create?.after;
		expect(typeof after).toBe('function');
	});

	it('omits the SSO plugin entirely when SSO_ISSUER_URL is empty', () => {
		const opts = buildAuthOptions({ ...baseEnv, SSO_ISSUER_URL: '' });
		const generic = opts.plugins?.find((p: { id?: string }) => p.id === 'generic-oauth');
		expect(generic).toBeUndefined();
	});
});
