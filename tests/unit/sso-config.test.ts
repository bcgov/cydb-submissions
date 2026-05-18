import { describe, it, expect } from 'vitest';
import { loadSsoConfig } from '$lib/server/sso-config';

describe('loadSsoConfig', () => {
	it('returns null when no SSO vars are set', () => {
		expect(loadSsoConfig({})).toBeNull();
	});

	it('returns config when all three are present', () => {
		expect(
			loadSsoConfig({
				SSO_ISSUER_URL: 'https://dev.loginproxy.gov.bc.ca/auth/realms/standard',
				SSO_CLIENT_ID: 'cydb-submissions-6444',
				SSO_CLIENT_SECRET: 'sek'
			})
		).toEqual({
			issuer: 'https://dev.loginproxy.gov.bc.ca/auth/realms/standard',
			clientId: 'cydb-submissions-6444',
			clientSecret: 'sek'
		});
	});

	it('throws when issuer is set but client id is missing', () => {
		expect(() =>
			loadSsoConfig({ SSO_ISSUER_URL: 'https://x/auth/realms/standard', SSO_CLIENT_SECRET: 'y' })
		).toThrow(/SSO_CLIENT_ID/);
	});

	it('throws when issuer is set but client secret is missing', () => {
		expect(() =>
			loadSsoConfig({ SSO_ISSUER_URL: 'https://x/auth/realms/standard', SSO_CLIENT_ID: 'y' })
		).toThrow(/SSO_CLIENT_SECRET/);
	});

	it('trims trailing slash from issuer', () => {
		const c = loadSsoConfig({
			SSO_ISSUER_URL: 'https://x/',
			SSO_CLIENT_ID: 'a',
			SSO_CLIENT_SECRET: 'b'
		});
		expect(c?.issuer).toBe('https://x');
	});
});
