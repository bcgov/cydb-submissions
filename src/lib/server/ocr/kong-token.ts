type FetchFn = typeof fetch;

export interface KongTokenOpts {
	tokenUrl: string;
	clientId: string;
	clientSecret: string;
	scope?: string;
	fetch?: FetchFn;
	skewSeconds?: number;
}

interface CachedToken {
	value: string;
	expiresAt: number;
}

export class KongTokenCache {
	private cached: CachedToken | null = null;
	private inflight: Promise<string> | null = null;

	constructor(private opts: KongTokenOpts) {}

	async token(): Promise<string> {
		const skew = this.opts.skewSeconds ?? 30;
		if (this.cached && this.cached.expiresAt - skew * 1000 > Date.now()) return this.cached.value;
		if (this.inflight) return this.inflight;
		this.inflight = this.fetchNew().finally(() => {
			this.inflight = null;
		});
		return this.inflight;
	}

	private async fetchNew(): Promise<string> {
		const fn = this.opts.fetch ?? fetch;
		const body = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: this.opts.clientId,
			client_secret: this.opts.clientSecret
		});
		if (this.opts.scope) body.set('scope', this.opts.scope);
		const res = await fn(this.opts.tokenUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body
		});
		if (!res.ok) {
			const text = res.text ? await res.text() : '';
			throw new Error(`Kong token endpoint failed: ${res.status} ${text.slice(0, 200)}`);
		}
		const j = (await res.json()) as { access_token: string; expires_in: number };
		this.cached = { value: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 };
		return this.cached.value;
	}
}
