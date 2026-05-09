import type { Mailer, MailMessage } from './types';

// Wire a real nodemailer transport when the BC Gov SMTP relay is confirmed.
// Until then this throws, so MAIL_TRANSPORT=smtp without a host fails fast
// rather than silently dropping alerts.
export class SmtpMailer implements Mailer {
	constructor(private opts: { host?: string; port?: number; user?: string; pass?: string }) {}
	async send(_msg: MailMessage): Promise<void> {
		if (!this.opts.host) {
			throw new Error('SmtpMailer: SMTP_HOST not configured; use MAIL_TRANSPORT=log');
		}
		throw new Error(
			'SmtpMailer: not yet wired (Phase 3 deliberate). Stay on MAIL_TRANSPORT=log until relay confirmed.'
		);
	}
}
