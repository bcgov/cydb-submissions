import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { selectMailer } from '$lib/server/mail/select-mailer';
import { LogMailer } from '$lib/server/mail/mailer-log';
import { ChesMailer } from '$lib/server/mail/mailer-ches';
import { SmtpMailer } from '$lib/server/mail/mailer-smtp';

const log = pino({ level: 'silent' });

describe('selectMailer', () => {
	it('defaults to LogMailer when MAIL_TRANSPORT is unset', () => {
		expect(selectMailer({}, log)).toBeInstanceOf(LogMailer);
	});

	it('returns SmtpMailer when MAIL_TRANSPORT=smtp', () => {
		expect(selectMailer({ MAIL_TRANSPORT: 'smtp' }, log)).toBeInstanceOf(SmtpMailer);
	});

	it('returns ChesMailer when MAIL_TRANSPORT=ches and all required env present', () => {
		const m = selectMailer(
			{
				MAIL_TRANSPORT: 'ches',
				CHES_TOKEN_URL: 'https://kc/token',
				CHES_CLIENT_ID: 'cid',
				CHES_CLIENT_SECRET: 'sek'
			},
			log
		);
		expect(m).toBeInstanceOf(ChesMailer);
	});

	it('throws when CHES_TOKEN_URL is missing', () => {
		expect(() =>
			selectMailer(
				{ MAIL_TRANSPORT: 'ches', CHES_CLIENT_ID: 'cid', CHES_CLIENT_SECRET: 'sek' },
				log
			)
		).toThrow(/CHES_TOKEN_URL/);
	});

	it('throws when CHES_CLIENT_ID is missing', () => {
		expect(() =>
			selectMailer(
				{ MAIL_TRANSPORT: 'ches', CHES_TOKEN_URL: 'https://kc/token', CHES_CLIENT_SECRET: 'sek' },
				log
			)
		).toThrow(/CHES_CLIENT_ID/);
	});

	it('throws when CHES_CLIENT_SECRET is missing', () => {
		expect(() =>
			selectMailer(
				{ MAIL_TRANSPORT: 'ches', CHES_TOKEN_URL: 'https://kc/token', CHES_CLIENT_ID: 'cid' },
				log
			)
		).toThrow(/CHES_CLIENT_SECRET/);
	});

	it('throws for an unknown transport', () => {
		expect(() => selectMailer({ MAIL_TRANSPORT: 'pigeon' }, log)).toThrow(/unknown MAIL_TRANSPORT/);
	});
});
