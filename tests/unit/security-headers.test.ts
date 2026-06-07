import { describe, it, expect } from 'vitest';
import { buildSecurityHeaders } from '$lib/server/security/headers';

describe('buildSecurityHeaders — response-header bundle (10.1, 10.2, 10.5, 10.6, 1.3)', () => {
	it('returns X-Frame-Options DENY', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: true });
		expect(h['x-frame-options']).toBe('DENY');
	});

	it('returns X-Content-Type-Options nosniff', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: true });
		expect(h['x-content-type-options']).toBe('nosniff');
	});

	it('returns Referrer-Policy same-origin or stricter', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: true });
		expect(['same-origin', 'no-referrer', 'strict-origin', 'strict-origin-when-cross-origin']).toContain(
			h['referrer-policy']
		);
	});

	it('does not emit content-security-policy (owned by kit.csp in svelte.config.js)', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: true });
		expect(h['content-security-policy']).toBeUndefined();
	});

	it('still sets the non-CSP hardening headers', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: true });
		expect(h['x-frame-options']).toBe('DENY');
		expect(h['x-content-type-options']).toBe('nosniff');
		expect(h['referrer-policy']).toBe('same-origin');
		expect(h['strict-transport-security']).toMatch(/max-age=/);
	});

	it('returns Strict-Transport-Security in production', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: true });
		expect(h['strict-transport-security']).toMatch(/max-age=\d+/);
		expect(h['strict-transport-security']).toMatch(/includeSubDomains/);
	});

	it('omits Strict-Transport-Security in non-production', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: false });
		expect(h['strict-transport-security']).toBeUndefined();
	});

	it("sets Cache-Control no-store for staff routes (3.6)", () => {
		for (const p of ['/admin', '/admin/queues', '/submissions', '/submissions/abc', '/clinician']) {
			const h = buildSecurityHeaders({ pathname: p, isProduction: true });
			expect(h['cache-control']).toMatch(/no-store/);
		}
	});

	it('leaves Cache-Control unset for the public landing page', () => {
		const h = buildSecurityHeaders({ pathname: '/', isProduction: true });
		expect(h['cache-control']).toBeUndefined();
	});

	it('leaves Cache-Control unset for /login (caching is fine — there is no PII)', () => {
		const h = buildSecurityHeaders({ pathname: '/login', isProduction: true });
		expect(h['cache-control']).toBeUndefined();
	});
});
