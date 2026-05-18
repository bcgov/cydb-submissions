import { describe, it, expect } from 'vitest';
import { redactPII } from '$lib/server/log';

describe('redactPII (phase 3 additions)', () => {
	it('redacts raw_text, body, and text keys', () => {
		const out = redactPII({
			jobId: 7,
			raw_text: 'Patient has autism and a Vineland score of 72',
			body: 'should not appear',
			text: 'should not appear either'
		}) as Record<string, unknown>;
		expect(out.jobId).toBe(7);
		expect(out.raw_text).toBe('[REDACTED]');
		expect(out.body).toBe('[REDACTED]');
		expect(out.text).toBe('[REDACTED]');
	});

	it('redacts authorization and apikey headers (case-insensitive)', () => {
		const out = redactPII({
			headers: { authorization: 'Bearer abc.def.ghi', Authorization: 'Bearer x', apikey: 'k123', ApiKey: 'k123' }
		}) as { headers: Record<string, string> };
		expect(out.headers.authorization).toBe('[REDACTED]');
		expect(out.headers.Authorization).toBe('[REDACTED]');
		expect(out.headers.apikey).toBe('[REDACTED]');
		expect(out.headers.ApiKey).toBe('[REDACTED]');
	});

	it('redacts the BC Gov DI x-api-key header (case-insensitive)', () => {
		const out = redactPII({
			headers: { 'x-api-key': 'secret-key', 'X-Api-Key': 'secret-key' }
		}) as { headers: Record<string, string> };
		expect(out.headers['x-api-key']).toBe('[REDACTED]');
		expect(out.headers['X-Api-Key']).toBe('[REDACTED]');
	});
});
