import { describe, it, expect } from 'vitest';
import { LogMailer } from '$lib/server/mail/mailer-log';
import type { Logger } from 'pino';

describe('LogMailer', () => {
	it('emits an error-level log entry with subject and recipients', async () => {
		const calls: Array<{ obj: Record<string, unknown>; msg: string }> = [];
		const fakeLogger = { error: (obj: Record<string, unknown>, msg: string) => calls.push({ obj, msg }) } as unknown as Logger;
		const m = new LogMailer(fakeLogger);
		await m.send({
			from: 'cydb@example.test',
			to: ['ops@example.test'],
			subject: '[CYDB OCR] queue halted',
			body: 'breaker tripped'
		});
		expect(calls).toHaveLength(1);
		expect(calls[0].obj.event).toBe('mail_logged');
		expect(calls[0].obj.subject).toBe('[CYDB OCR] queue halted');
		expect(calls[0].obj.to).toEqual(['ops@example.test']);
		// Body must NOT be in the structured payload (defence in depth — pino redactor would scrub it too).
		expect(JSON.stringify(calls[0])).not.toContain('breaker tripped');
	});
});
