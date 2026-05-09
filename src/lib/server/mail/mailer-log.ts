import type { Logger } from 'pino';
import type { Mailer, MailMessage } from './types';

export class LogMailer implements Mailer {
	constructor(private log: Logger) {}
	async send(msg: MailMessage): Promise<void> {
		// Subject + recipients only; body stays out of the structured payload.
		this.log.error(
			{ event: 'mail_logged', subject: msg.subject, to: msg.to, from: msg.from },
			'mail send attempted (LogMailer is configured; no SMTP transport wired)'
		);
	}
}
