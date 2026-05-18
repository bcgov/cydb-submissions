export interface BuildSecurityHeadersArgs {
	pathname: string;
	isProduction: boolean;
}

const STAFF_PREFIXES = ['/admin', '/submissions', '/clinician'];

function isStaffPath(pathname: string): boolean {
	return STAFF_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

export function buildSecurityHeaders(args: BuildSecurityHeadersArgs): Record<string, string> {
	const csp = [
		"default-src 'self'",
		"script-src 'self'",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"object-src 'none'"
	].join('; ');

	const headers: Record<string, string> = {
		'x-frame-options': 'DENY',
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'same-origin',
		'content-security-policy': csp
	};

	if (args.isProduction) {
		headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
	}

	if (isStaffPath(args.pathname)) {
		headers['cache-control'] = 'private, no-store';
	}

	return headers;
}
