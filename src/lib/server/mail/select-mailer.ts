import type { Logger } from 'pino';
import type { Mailer } from './types';
import { LogMailer } from './mailer-log';
import { SmtpMailer } from './mailer-smtp';
import { ChesMailer } from './mailer-ches';
import { ChesTokenCache } from './ches-token';

export interface MailerEnv {
	MAIL_TRANSPORT?: string;
	SMTP_HOST?: string;
	SMTP_PORT?: string;
	SMTP_USER?: string;
	SMTP_PASS?: string;
	CHES_BASE_URL?: string;
	CHES_TOKEN_URL?: string;
	CHES_CLIENT_ID?: string;
	CHES_CLIENT_SECRET?: string;
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
	if (t === 'ches') {
		const baseUrl = env.CHES_BASE_URL ?? 'https://ches.api.gov.bc.ca/api/v1';
		const tokenUrl = env.CHES_TOKEN_URL;
		const clientId = env.CHES_CLIENT_ID;
		const clientSecret = env.CHES_CLIENT_SECRET;
		if (!tokenUrl) throw new Error('CHES_TOKEN_URL is required for MAIL_TRANSPORT=ches');
		if (!clientId) throw new Error('CHES_CLIENT_ID is required for MAIL_TRANSPORT=ches');
		if (!clientSecret) throw new Error('CHES_CLIENT_SECRET is required for MAIL_TRANSPORT=ches');
		const tokenCache = new ChesTokenCache({ tokenUrl, clientId, clientSecret });
		return new ChesMailer({ baseUrl, tokenCache });
	}
	throw new Error(`unknown MAIL_TRANSPORT: ${t}`);
}
