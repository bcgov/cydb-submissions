export function safeNextUrl(
	next: string | null | undefined,
	origin: string,
	fallback: string
): string {
	if (typeof next !== 'string' || next.length === 0) return fallback;
	// Reject any pseudo-scheme (javascript:, data:, vbscript:, file:, etc.) and
	// protocol-relative URLs that hand control of origin to a remote host.
	if (next.startsWith('//')) return fallback;
	if (/^[a-z][a-z0-9+.-]*:/i.test(next) === false) {
		// Not a URL with a scheme — must be a leading-slash absolute path on this origin.
		return next.startsWith('/') ? next : fallback;
	}
	// Absolute URL with a scheme. Accept only when http(s) AND origin matches.
	try {
		const u = new URL(next);
		const o = new URL(origin);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
		if (u.origin !== o.origin) return fallback;
		return u.pathname + u.search + u.hash;
	} catch {
		return fallback;
	}
}

const ALLOWED_APEX = 'gov.bc.ca';
const PRIVATE_V4 = [
	/^10\./,
	/^192\.168\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^127\./,
	/^169\.254\./,
	/^0\./
];

export function isAllowedChefsBaseUrl(input: string): boolean {
	if (!input) return false;
	let u: URL;
	try {
		u = new URL(input);
	} catch {
		return false;
	}
	if (u.protocol !== 'https:') return false;
	const host = u.hostname.toLowerCase();
	if (!host) return false;
	if (host === 'localhost') return false;
	if (PRIVATE_V4.some((re) => re.test(host))) return false;
	// kubernetes.default[.svc] and similar in-cluster service DNS — block.
	if (host === 'kubernetes.default' || host.endsWith('.kubernetes.default')) return false;
	if (host === 'kubernetes.default.svc' || host.endsWith('.kubernetes.default.svc')) return false;
	if (host === ALLOWED_APEX) return true;
	return host.endsWith('.' + ALLOWED_APEX);
}
