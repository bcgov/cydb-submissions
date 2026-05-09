import type { Logger } from 'pino';
import type { Mailer } from './types';
import { LogMailer } from './mailer-log';
import { SmtpMailer } from './mailer-smtp';

export interface MailerEnv {
	MAIL_TRANSPORT?: string;
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USER?: string;
	SMTP_PASS?: string;
}

export function selectMailer(env: MailerEnv, log: Logger): Mailer {
	const t = env.MAIL_TRANSPORT ?? 'log';
	if (t === 'log') return new LogMailer(log);
	if (t === 'smtp') {
		return new SmtpMailer({
			host: env.SMTP_HOST,
			port: env.SMTP_PORT ? Number(env.SMTP_PORT) : undefined,
			user: env.SMTP_USER,
			pass: env.SMTP_PASS
		});
	}
	throw new Error(`unknown MAIL_TRANSPORT: ${t}`);
}
