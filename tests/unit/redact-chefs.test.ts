import { describe, it, expect } from 'vitest';
import { redactPII } from '$lib/server/log';

describe('redactPII (chefs additions)', () => {
	it('redacts apiToken and api_token keys', () => {
		const out = redactPII({
			formId: 'public-uuid',
			apiToken: 'super-secret-abc',
			api_token: 'also-secret-xyz'
		}) as Record<string, unknown>;
		expect(out.formId).toBe('public-uuid');
		expect(out.apiToken).toBe('[REDACTED]');
		expect(out.api_token).toBe('[REDACTED]');
	});

	it('redacts apiToken nested under a chefs key', () => {
		const out = redactPII({
			chefs: { formId: 'public', apiToken: 'super-secret-abc' }
		}) as { chefs: Record<string, unknown> };
		expect(out.chefs.formId).toBe('public');
		expect(out.chefs.apiToken).toBe('[REDACTED]');
	});
});
