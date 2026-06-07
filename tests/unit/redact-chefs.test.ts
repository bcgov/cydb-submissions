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

	it('redacts new form child/signatory name fields (CHEFS payload field names)', () => {
		const out = redactPII({
			childYouthsFirstName: 'Jordan',
			childYouthsMiddleNameS: 'Lee',
			childYouthsLegalLastName: 'Smith',
			agreementSignatorysLegalFirstName: 'Alex',
			agreementSignatorysLegalLastName: 'Smith',
			screening: 'Yes'
		}) as Record<string, unknown>;
		expect(out.childYouthsFirstName).toBe('[REDACTED]');
		expect(out.childYouthsMiddleNameS).toBe('[REDACTED]');
		expect(out.childYouthsLegalLastName).toBe('[REDACTED]');
		expect(out.agreementSignatorysLegalFirstName).toBe('[REDACTED]');
		expect(out.agreementSignatorysLegalLastName).toBe('[REDACTED]');
		expect(out.screening).toBe('Yes'); // non-PII field preserved
	});

	it('redacts new DB column child/signatory name fields (camelCase)', () => {
		const out = redactPII({
			childYouthFirstName: 'Oliver',
			childYouthMiddleNames: null,
			childYouthLastName: 'Adams',
			signatoryFirstName: 'Patricia',
			signatoryLastName: 'Adams',
			submitterSurname: 'Adams'
		}) as Record<string, unknown>;
		expect(out.childYouthFirstName).toBe('[REDACTED]');
		expect(out.childYouthLastName).toBe('[REDACTED]');
		expect(out.signatoryFirstName).toBe('[REDACTED]');
		expect(out.signatoryLastName).toBe('[REDACTED]');
		expect(out.submitterSurname).toBe('[REDACTED]');
	});

	it('redacts DOB fields (both form and DB column names)', () => {
		const out = redactPII({
			childYouthsDateOfBirth: '2015-06-01',
			childYouthsDateOfBirth1: '1985-02-20',
			childYouthDob: '2015-06-01',
			signatoryDob: '1985-02-20'
		}) as Record<string, unknown>;
		expect(out.childYouthsDateOfBirth).toBe('[REDACTED]');
		expect(out.childYouthsDateOfBirth1).toBe('[REDACTED]');
		expect(out.childYouthDob).toBe('[REDACTED]');
		expect(out.signatoryDob).toBe('[REDACTED]');
	});

	it('redacts primaryPhoneNumber and primaryPhone', () => {
		const out = redactPII({
			primaryPhoneNumber: '604-555-0101',
			primaryPhone: '778-555-0202',
			email: 'test@example.com'
		}) as Record<string, unknown>;
		expect(out.primaryPhoneNumber).toBe('[REDACTED]');
		expect(out.primaryPhone).toBe('[REDACTED]');
		expect(out.email).toBe('[REDACTED]');
	});

	it('redacts signature (data-URL) and dateSigned', () => {
		const out = redactPII({
			signature: 'data:image/png;base64,abc123',
			dateSigned: '2026-06-01',
			status: 'submitted'
		}) as Record<string, unknown>;
		expect(out.signature).toBe('[REDACTED]');
		expect(out.dateSigned).toBe('[REDACTED]');
		expect(out.status).toBe('submitted'); // non-PII preserved
	});
});
