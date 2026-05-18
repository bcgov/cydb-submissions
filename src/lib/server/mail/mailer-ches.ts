import type { Mailer, MailMessage } from './types';
import type { ChesTokenCache } from './ches-token';

type FetchFn = typeof fetch;

export interface ChesMailerOpts {
	baseUrl: string;
	tokenCache: ChesTokenCache;
	fetch?: FetchFn;
}

export class ChesMailer implements Mailer {
	private fetch: FetchFn;

	constructor(private opts: ChesMailerOpts) {
		this.fetch = opts.fetch ?? fetch;
	}

	async send(msg: MailMessage): Promise<void> {
		const token = await this.opts.tokenCache.token();
		const res = await this.fetch(`${this.opts.baseUrl}/email`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({
				from: msg.from,
				to: msg.to,
				subject: msg.subject,
				bodyType: 'text',
				body: msg.body
			})
		});
		if (!res.ok) {
			const text = res.text ? await res.text() : '';
			throw new Error(`CHES request failed: HTTP ${res.status} ${text.slice(0, 200)}`);
		}
	}
}
