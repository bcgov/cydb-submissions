import { describe, it, expect } from 'vitest';
import { safeNextUrl, isAllowedChefsBaseUrl } from '$lib/server/security/url-safety';

describe('safeNextUrl — open-redirect defence (6.7)', () => {
	const origin = 'https://cydb.example.gov.bc.ca';
	const fallback = '/admin';

	it('accepts an in-origin absolute URL and returns the path+search', () => {
		expect(safeNextUrl(`${origin}/submissions?status=submitted`, origin, fallback)).toBe(
			'/submissions?status=submitted'
		);
	});

	it('accepts a relative absolute path', () => {
		expect(safeNextUrl('/admin/queues', origin, fallback)).toBe('/admin/queues');
	});

	it('rejects an external HTTPS URL', () => {
		expect(safeNextUrl('https://attacker.example/phish', origin, fallback)).toBe(fallback);
	});

	it('rejects a protocol-relative URL (//attacker)', () => {
		expect(safeNextUrl('//attacker.example/phish', origin, fallback)).toBe(fallback);
	});

	it('rejects a javascript: pseudo-URL', () => {
		expect(safeNextUrl('javascript:alert(1)', origin, fallback)).toBe(fallback);
	});

	it('rejects a data: URL', () => {
		expect(safeNextUrl('data:text/html,<script>alert(1)</script>', origin, fallback)).toBe(
			fallback
		);
	});

	it('rejects an empty / null / non-string input by returning the fallback', () => {
		expect(safeNextUrl('', origin, fallback)).toBe(fallback);
		expect(safeNextUrl(null, origin, fallback)).toBe(fallback);
		expect(safeNextUrl(undefined, origin, fallback)).toBe(fallback);
	});

	it('rejects suffix-spoof "https://cydb.example.gov.bc.ca.attacker.example/..."', () => {
		expect(
			safeNextUrl(`https://cydb.example.gov.bc.ca.attacker.example/x`, origin, fallback)
		).toBe(fallback);
	});

	it('rejects a path that does not start with /', () => {
		// "admin/foo" (no leading slash) is ambiguous; treat as untrusted.
		expect(safeNextUrl('admin/foo', origin, fallback)).toBe(fallback);
	});
});

describe('isAllowedChefsBaseUrl — SSRF guardrail (6.6)', () => {
	it('accepts the canonical CHEFS host', () => {
		expect(isAllowedChefsBaseUrl('https://submit.digital.gov.bc.ca')).toBe(true);
	});

	it('accepts any *.gov.bc.ca subdomain', () => {
		expect(isAllowedChefsBaseUrl('https://forms.gov.bc.ca')).toBe(true);
		expect(isAllowedChefsBaseUrl('https://chefs-test.gov.bc.ca')).toBe(true);
	});

	it('accepts the bare gov.bc.ca apex', () => {
		expect(isAllowedChefsBaseUrl('https://gov.bc.ca')).toBe(true);
	});

	it('rejects an unrelated public host', () => {
		expect(isAllowedChefsBaseUrl('https://example.com')).toBe(false);
		expect(isAllowedChefsBaseUrl('https://attacker.example')).toBe(false);
	});

	it('rejects suffix-spoof gov.bc.ca.attacker.example', () => {
		expect(isAllowedChefsBaseUrl('https://gov.bc.ca.attacker.example')).toBe(false);
	});

	it('rejects http:// (non-TLS)', () => {
		expect(isAllowedChefsBaseUrl('http://submit.digital.gov.bc.ca')).toBe(false);
	});

	it('rejects RFC1918 private addresses', () => {
		expect(isAllowedChefsBaseUrl('https://10.0.0.1')).toBe(false);
		expect(isAllowedChefsBaseUrl('https://192.168.1.1')).toBe(false);
		expect(isAllowedChefsBaseUrl('https://172.16.0.1')).toBe(false);
	});

	it('rejects loopback', () => {
		expect(isAllowedChefsBaseUrl('https://127.0.0.1')).toBe(false);
		expect(isAllowedChefsBaseUrl('https://localhost')).toBe(false);
	});

	it('rejects the AWS metadata IP', () => {
		expect(isAllowedChefsBaseUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
		expect(isAllowedChefsBaseUrl('https://169.254.169.254')).toBe(false);
	});

	it('rejects the Kubernetes default service DNS', () => {
		expect(isAllowedChefsBaseUrl('https://kubernetes.default')).toBe(false);
		expect(isAllowedChefsBaseUrl('https://kubernetes.default.svc')).toBe(false);
	});

	it('rejects malformed URLs', () => {
		expect(isAllowedChefsBaseUrl('not-a-url')).toBe(false);
		expect(isAllowedChefsBaseUrl('')).toBe(false);
	});
});
